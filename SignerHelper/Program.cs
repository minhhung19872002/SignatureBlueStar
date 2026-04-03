using System.Security.Cryptography.Pkcs;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using System.Text.RegularExpressions;

return await ProgramMain.RunAsync(args);

internal static class ProgramMain
{
    public static async Task<int> RunAsync(string[] args)
    {
        try
        {
            if (args.Length == 0)
            {
                throw new InvalidOperationException("Missing command.");
            }

            return args[0].ToLowerInvariant() switch
            {
                "list" => ListCertificatesAsync(),
                "sign" => SignAsync(args),
                "signbatch" => SignBatchAsync(args),
                _ => throw new InvalidOperationException($"Unsupported command: {args[0]}")
            };
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex.Message);
            return 1;
        }
    }

    private static int ListCertificatesAsync()
    {
        var certificates = new List<object>();
        foreach (var location in new[] { StoreLocation.CurrentUser, StoreLocation.LocalMachine })
        {
            using var store = new X509Store(StoreName.My, location);
            store.Open(OpenFlags.ReadOnly | OpenFlags.OpenExistingOnly);

            foreach (var cert in store.Certificates)
            {
                if (!cert.HasPrivateKey) continue;
                if (!ContainsWinCaMarker(cert)) continue;

                certificates.Add(new
                {
                    thumbprint = cert.Thumbprint,
                    subject = cert.Subject,
                    issuer = cert.Issuer,
                    notAfter = cert.NotAfter,
                    storeLocation = location.ToString()
                });
            }
        }

        Console.WriteLine(JsonSerializer.Serialize(certificates));
        return 0;
    }

    // signbatch <thumbprint> <input1> <output1> [<input2> <output2> ...]
    // All files signed in ONE process — PIN prompted ONCE
    private static int SignBatchAsync(string[] args)
    {
        try
        {
            if (args.Length < 4 || (args.Length - 2) % 2 != 0)
            {
                Console.Error.WriteLine(JsonSerializer.Serialize(new { error = "Usage: signbatch <thumbprint> <input1> <output1> [<input2> <output2> ...]" }));
                return 1;
            }

            var thumbprint = NormalizeThumbprint(args[1]);

            X509Certificate2? certificate = FindCertificate(thumbprint);
            if (certificate == null)
            {
                Console.Error.WriteLine(JsonSerializer.Serialize(new { error = $"Certificate not found for thumbprint {thumbprint}." }));
                return 1;
            }

            // Pre-authenticate ONCE — PIN dialog fires here
            var preAuthSigner = new CmsSigner(SubjectIdentifierType.IssuerAndSerialNumber, certificate)
            {
                IncludeOption = X509IncludeOption.EndCertOnly
            };
            preAuthSigner.SignedAttributes.Add(new Pkcs9SigningTime(DateTime.UtcNow));

            var pairs = new List<(string Input, string Output)>();
            for (int i = 2; i < args.Length; i += 2)
            {
                pairs.Add((args[i], args[i + 1]));
            }

            var results = new List<object>();
            bool anySuccess = false;

            foreach (var (inputPath, outputPath) in pairs)
            {
                try
                {
                    var pdfBytes = File.ReadAllBytes(inputPath);

                    // Step 1: Find ByteRange placeholder position
                    // PDF stores ByteRange as PDFName.of('**********') = '/**********' in ASCII
                    // Search for '/ByteRange' then find the placeholder '/**********'
                    int brPlaceholderPos = -1;
                    for (int i = 0; i < pdfBytes.Length - 15; i++)
                    {
                        if (pdfBytes[i] == 0x2F && pdfBytes[i+1] == 0x42 && pdfBytes[i+2] == 0x79 &&
                            pdfBytes[i+3] == 0x74 && pdfBytes[i+4] == 0x65 && pdfBytes[i+5] == 0x52 &&
                            pdfBytes[i+6] == 0x61 && pdfBytes[i+7] == 0x6E && pdfBytes[i+8] == 0x67 && pdfBytes[i+9] == 0x65)
                        {
                            brPlaceholderPos = i;
                            break;
                        }
                    }
                    if (brPlaceholderPos < 0) throw new InvalidOperationException("No /ByteRange found in PDF.");

                    // Step 2: Find the ByteRange placeholder string
                    // Find '[' after '/ByteRange'
                    int bracketStart = Array.IndexOf(pdfBytes, (byte)'[', brPlaceholderPos);
                    int bracketEnd = Array.IndexOf(pdfBytes, (byte)']', bracketStart);
                    if (bracketStart < 0 || bracketEnd < 0)
                        throw new InvalidOperationException("Could not parse ByteRange brackets.");

                    var brPlaceholderStr = System.Text.Encoding.ASCII.GetString(pdfBytes, bracketStart, bracketEnd - bracketStart + 1);

                    // Step 3: Find Contents '<' marker after ByteRange
                    int contentsTagPos = Array.IndexOf(pdfBytes, (byte)'<', bracketEnd);
                    if (contentsTagPos < 0) throw new InvalidOperationException("No /Contents marker in PDF.");

                    // Step 4: Find '>' closing the hex string (after 2 chars for <>)
                    int contentsEnd = Array.IndexOf(pdfBytes, (byte)'>', contentsTagPos + 1);
                    if (contentsEnd < 0) throw new InvalidOperationException("No closing > for Contents hex string.");

                    int hexLen = contentsEnd - contentsTagPos - 1; // -1 for '<'
                    int sigByteLen = hexLen / 2; // PDF hex: 2 chars per byte

                    // ByteRange = [0, placeholderStart, placeholderStart, restOfFile]
                    // placeholderStart = byte index of '<'
                    // sigByteLen = actual bytes in placeholder
                    // rest = fileSize - placeholderStart - sigByteLen
                    int placeholderStart = contentsTagPos;
                    int restLen = pdfBytes.Length - placeholderStart - sigByteLen;

                    var actualByteRange = $"/ByteRange [0 {placeholderStart} {placeholderStart} {restLen}]";

                    // Pad to same length as original placeholder for consistent PDF structure
                    if (actualByteRange.Length < brPlaceholderStr.Length)
                        actualByteRange = actualByteRange + new string(' ', brPlaceholderStr.Length - actualByteRange.Length);

                    // Step 5: Build content to sign = [0 to placeholderStart) + [placeholderStart+sigByteLen to end)
                    var contentToSign = new byte[placeholderStart + restLen];
                    Array.Copy(pdfBytes, 0, contentToSign, 0, placeholderStart);
                    Array.Copy(pdfBytes, placeholderStart + sigByteLen, contentToSign, placeholderStart, restLen);

                    // Step 6: Sign
                    var contentInfo = new ContentInfo(contentToSign);
                    var signedCms = new SignedCms(contentInfo, detached: true);
                    signedCms.ComputeSignature(preAuthSigner);
                    var sigBytes = signedCms.Encode();

                    if (sigBytes.Length > sigByteLen)
                        throw new InvalidOperationException($"Signature too large: {sigBytes.Length} > {sigByteLen}");

                    // Step 7: Build signed PDF
                    // Pad hex signature to fill placeholder
                    var sigHex = BitConverter.ToString(sigBytes).Replace("-", "");
                    sigHex = sigHex.PadRight(hexLen, '0');

                    var newBrBytes = System.Text.Encoding.ASCII.GetBytes(actualByteRange);

                    using var output = new MemoryStream();
                    output.Write(pdfBytes, 0, bracketStart);          // PDF up to '['
                    output.Write(newBrBytes, 0, newBrBytes.Length);   // New ByteRange line
                    output.Write(pdfBytes, bracketEnd + 1, contentsTagPos - bracketEnd - 1); // Between ] and <
                    output.WriteByte((byte)'<');                        // '<'
                    output.Write(System.Text.Encoding.ASCII.GetBytes(sigHex), 0, sigHex.Length); // Sig hex
                    output.WriteByte((byte)'>');                       // '>'
                    output.Write(pdfBytes, contentsEnd + 1, pdfBytes.Length - contentsEnd - 1); // After >

                    File.WriteAllBytes(outputPath, output.ToArray());
                    anySuccess = true;
                    results.Add(new { input = inputPath, success = true, error = (string?)null, outputSize = output.Length });
                }
                catch (Exception ex)
                {
                    results.Add(new { input = inputPath, success = false, error = ex.Message });
                }
            }

            Console.WriteLine(JsonSerializer.Serialize(results));
            return anySuccess ? 0 : 1;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(JsonSerializer.Serialize(new { error = ex.Message }));
            return 1;
        }
    }

    private static int SignAsync(string[] args)
    {
        if (args.Length < 4)
        {
            throw new InvalidOperationException("Usage: sign <thumbprint> <inputFile> <outputFile>");
        }

        var thumbprint = NormalizeThumbprint(args[1]);
        var inputFile = args[2];
        var outputFile = args[3];

        var certificate = FindCertificate(thumbprint)
            ?? throw new InvalidOperationException($"Certificate not found for thumbprint {thumbprint}.");

        var content = File.ReadAllBytes(inputFile);
        var contentInfo = new ContentInfo(content);
        var signedCms = new SignedCms(contentInfo, detached: true);
        var signer = new CmsSigner(SubjectIdentifierType.IssuerAndSerialNumber, certificate)
        {
            IncludeOption = X509IncludeOption.EndCertOnly
        };

        signer.SignedAttributes.Add(new Pkcs9SigningTime(DateTime.UtcNow));
        signedCms.ComputeSignature(signer);
        File.WriteAllBytes(outputFile, signedCms.Encode());

        return 0;
    }

    private static X509Certificate2? FindCertificate(string thumbprint)
    {
        foreach (var location in new[] { StoreLocation.CurrentUser, StoreLocation.LocalMachine })
        {
            using var store = new X509Store(StoreName.My, location);
            store.Open(OpenFlags.ReadOnly | OpenFlags.OpenExistingOnly);
            foreach (var cert in store.Certificates)
            {
                if (!cert.HasPrivateKey) continue;
                if (NormalizeThumbprint(cert.Thumbprint) == thumbprint)
                    return cert;
            }
        }
        return null;
    }

    private static bool ContainsWinCaMarker(X509Certificate2 cert)
    {
        var subject = cert.Subject.ToUpperInvariant();
        var issuer = cert.Issuer.ToUpperInvariant();
        return issuer.Contains("WINCA") || issuer.Contains("WINGROUP") || subject.Contains("WINCA");
    }

    private static string NormalizeThumbprint(string? thumbprint)
    {
        return (thumbprint ?? string.Empty).Replace(" ", string.Empty).ToUpperInvariant();
    }
}
