using System.Security.Cryptography.Pkcs;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;

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
                "list" => await ListCertificatesAsync(),
                "sign" => await SignAsync(args),
                _ => throw new InvalidOperationException($"Unsupported command: {args[0]}")
            };
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex.Message);
            return 1;
        }
    }

    private static Task<int> ListCertificatesAsync()
    {
        var certificates = new List<object>();
        foreach (var location in new[] { StoreLocation.CurrentUser, StoreLocation.LocalMachine })
        {
            using var store = new X509Store(StoreName.My, location);
            store.Open(OpenFlags.ReadOnly | OpenFlags.OpenExistingOnly);

            foreach (var cert in store.Certificates)
            {
                if (!cert.HasPrivateKey)
                {
                    continue;
                }

                if (!ContainsWinCaMarker(cert))
                {
                    continue;
                }

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
        return Task.FromResult(0);
    }

    private static Task<int> SignAsync(string[] args)
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

        return Task.FromResult(0);
    }

    private static X509Certificate2? FindCertificate(string thumbprint)
    {
        foreach (var location in new[] { StoreLocation.CurrentUser, StoreLocation.LocalMachine })
        {
            using var store = new X509Store(StoreName.My, location);
            store.Open(OpenFlags.ReadOnly | OpenFlags.OpenExistingOnly);
            foreach (var cert in store.Certificates)
            {
                if (!cert.HasPrivateKey)
                {
                    continue;
                }

                if (NormalizeThumbprint(cert.Thumbprint) == thumbprint)
                {
                    return cert;
                }
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
