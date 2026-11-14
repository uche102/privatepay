Add-Type -AssemblyName System.Drawing

$source = @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Linq;
using System.Runtime.Serialization;

public static class PrivatePayDemo
{
    const int W = 1280, H = 720;
    static readonly Color Purple = Color.FromArgb(39, 0, 108);
    static readonly Color Card = Color.FromArgb(48, 5, 130);
    static readonly Color Gold = Color.FromArgb(255, 197, 46);
    static readonly Color White = Color.FromArgb(250, 246, 255);
    static readonly Color Muted = Color.FromArgb(211, 195, 232);
    static readonly Font Title = new Font("Arial", 38, FontStyle.Bold);
    static readonly Font Head = new Font("Arial", 25, FontStyle.Bold);
    static readonly Font Body = new Font("Arial", 18, FontStyle.Regular);
    static readonly Font Small = new Font("Arial", 13, FontStyle.Regular);

    static void Text(Graphics g, string value, float x, float y, Font f, Color c)
    {
        using (var b = new SolidBrush(c)) g.DrawString(value, f, b, x, y);
    }
    static void Box(Graphics g, float x, float y, float w, float h, Color c, float radius = 16)
    {
        using (var p = new GraphicsPath())
        using (var b = new SolidBrush(c))
        {
            float d = radius * 2;
            p.AddArc(x, y, d, d, 180, 90); p.AddArc(x + w - d, y, d, d, 270, 90);
            p.AddArc(x + w - d, y + h - d, d, d, 0, 90); p.AddArc(x, y + h - d, d, d, 90, 90);
            p.CloseFigure(); g.FillPath(b, p);
        }
    }
    static void Base(Graphics g, int n, string kicker, string heading, string sub)
    {
        using (var b = new LinearGradientBrush(new Rectangle(0,0,W,H), Purple, Color.FromArgb(54,18,145), 25f)) g.FillRectangle(b, 0, 0, W, H);
        using (var b = new SolidBrush(Color.FromArgb(40, 64, 125, 255))) g.FillEllipse(b, 820, -220, 620, 620);
        Text(g, "PRIVATEPAY", 68, 48, new Font("Arial", 17, FontStyle.Bold), White);
        Box(g, 68, 94, 52, 5, Gold, 2);
        Text(g, kicker.ToUpperInvariant(), 68, 142, Small, Gold);
        Text(g, heading, 68, 174, Title, White);
        Text(g, sub, 68, 234, Body, Muted);
        Text(g, "ZCASH TESTNET DEMO  -  " + n.ToString("00") + " / 06", 930, 654, Small, Muted);
    }
    static Bitmap Frame(int n)
    {
        var bmp = new Bitmap(W, H, PixelFormat.Format24bppRgb);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias; g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
            if (n == 0)
            {
                Base(g, 1, "Freelance payments, simplified", "Invoice. Collect. Pay out.", "Create a private invoice and share it with your client.");
                Box(g, 700, 280, 470, 280, Card);
                Text(g, "01   CREATE AN INVOICE", 738, 322, Head, Gold);
                Text(g, "02   SHARE A PAYMENT LINK", 738, 390, Head, White);
                Text(g, "03   RECEIVE ZCASH", 738, 458, Head, White);
                Box(g, 68, 330, 430, 116, Color.FromArgb(29, 0, 77));
                Text(g, "Private invoices.", 98, 350, Head, White);
                Text(g, "Powerful payouts.", 98, 395, Head, Gold);
            }
            else if (n == 1)
            {
                Base(g, 2, "Step 1  •  Freelancer", "Sign in with Pollar", "Email login connects a Pollar wallet to the freelancer account.");
                Box(g, 68, 304, 500, 248, Card);
                Text(g, "SIGNED-IN WALLET", 98, 338, Small, Gold);
                Box(g, 98, 376, 440, 58, Color.FromArgb(29,0,77));
                Text(g, "G... wallet address from Pollar", 116, 394, Body, White);
                Text(g, "Used to associate invoices with this account.", 98, 468, Small, Muted);
                Box(g, 660, 304, 510, 248, Color.FromArgb(29,0,77));
                Text(g, "ACCOUNT IDENTITY", 694, 340, Small, Gold);
                Text(g, "Pollar wallet", 694, 378, Head, White);
                Text(g, "Zcash address", 694, 430, Head, White);
                Text(g, "Separate destination entered for each invoice.", 694, 480, Small, Muted);
            }
            else if (n == 2)
            {
                Base(g, 3, "Step 2  •  Invoice details", "Set the terms", "Choose the Zcash destination and enter the NGN amount, rate and fee.");
                Box(g, 68, 300, 520, 286, Card);
                string[] rows = { "Zcash receiving address   [your testnet address]", "Amount   \u20A61,650", "Rate   \u20A6200 per ZEC", "Platform fee   0.00015%", "Description   Logo design" };
                for (int i=0;i<rows.Length;i++) { Box(g, 96, 326+i*47, 464, 36, Color.FromArgb(29,0,77), 8); Text(g, rows[i], 109, 334+i*47, Small, i==0?Muted:White); }
                Box(g, 650, 344, 520, 186, Color.FromArgb(29,0,77));
                Text(g, "ESTIMATED FREELANCER PAYOUT", 684, 380, Small, Gold);
                Text(g, "\u20A61,650.00", 684, 418, Title, White);
                Text(g, "0.00015% fee (payout rounded to 2 decimals)", 684, 480, Small, Muted);
            }
            else if (n == 3)
            {
                Base(g, 4, "Step 3  •  Share", "Create the invoice link", "Your client opens a public invoice with the payment amount and recipient.");
                Box(g, 340, 300, 600, 294, Card);
                Text(g, "PAYMENT REQUEST", 382, 332, Small, Gold);
                Text(g, "Logo design", 382, 366, Head, White);
                Text(g, "\u20A61,650", 382, 411, Title, White);
                Text(g, "Amount to send  8.25 ZEC", 382, 470, Body, Muted);
                Box(g, 382, 520, 510, 44, Gold, 20);
                Text(g, "COPY ZCASH ADDRESS", 523, 532, Small, Purple);
            }
            else if (n == 4)
            {
                Base(g, 5, "Step 4  •  Client payment", "Send from a Zcash wallet", "Copy the raw address, select the matching testnet, and enter the ZEC amount.");
                Box(g, 68, 312, 504, 268, Color.FromArgb(17, 28, 24));
                Text(g, "SEND ZEC  -  TESTNET", 101, 343, Small, Gold);
                Box(g, 101, 384, 438, 56, Color.FromArgb(28, 43, 36), 12);
                Text(g, "utest1... recipient address", 122, 400, Small, White);
                Box(g, 101, 462, 438, 56, Color.FromArgb(28, 43, 36), 12);
                Text(g, "8.25 ZEC", 122, 478, Body, White);
                Box(g, 650, 352, 520, 162, Card);
                Text(g, "The invoice page copies the address.", 686, 384, Body, White);
                Text(g, "The client sends the payment manually.", 686, 438, Body, White);
                Text(g, "No seed phrase is entered in PrivatePay.", 686, 478, Small, Muted);
            }
            else
            {
                Base(g, 6, "Step 5  •  Verify and pay out", "Status follows the backend", "Payment checks and genuine payouts require the server’s Zcash RPC wallet.");
                string[] steps = { "Invoice created", "Payment submitted", "Payment confirmed", "Payout verified" };
                for (int i=0;i<steps.Length;i++)
                {
                    int x=68+i*292;
                    Box(g, x, 348, 258, 122, Card);
                    Text(g, (i+1).ToString("00"), x+22, 364, Small, Gold);
                    Text(g, steps[i], x+22, 398, new Font("Arial", 16, FontStyle.Bold), White);
                    if (i<steps.Length-1) Text(g, ">", x+263, 389, Head, Gold);
                }
                Box(g, 68, 514, 1100, 74, Color.FromArgb(29,0,77));
                Text(g, "A payout is only marked complete after the configured wallet sends and verifies it.", 98, 536, Body, Muted);
                Text(g, "PrivatePay", 68, 610, Head, Gold);
                Text(g, "Private invoices. Powerful payouts.", 250, 620, Body, White);
            }
        }
        return bmp;
    }
    static PropertyItem GifProperty(int id, byte[] value)
    {
        var p = (PropertyItem)FormatterServices.GetUninitializedObject(typeof(PropertyItem));
        p.Id = id; p.Type = 4; p.Len = value.Length; p.Value = value; return p;
    }
    public static void Save(string path)
    {
        var frames = Enumerable.Range(0, 6).Select(Frame).ToArray();
        var codec = ImageCodecInfo.GetImageEncoders().First(x => x.MimeType == "image/gif");
        using (var ep = new EncoderParameters(1))
        {
            ep.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.SaveFlag, (long)EncoderValue.MultiFrame);
            frames[0].SetPropertyItem(GifProperty(0x5100, BitConverter.GetBytes(700)));
            frames[0].SetPropertyItem(GifProperty(0x5101, BitConverter.GetBytes(0)));
            frames[0].Save(path, codec, ep);
            ep.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.SaveFlag, (long)EncoderValue.FrameDimensionTime);
            for (int i=1;i<frames.Length;i++) { frames[i].SetPropertyItem(GifProperty(0x5100, BitConverter.GetBytes(700))); frames[0].SaveAdd(frames[i], ep); }
            ep.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.SaveFlag, (long)EncoderValue.Flush);
            frames[0].SaveAdd(ep);
        }
        foreach (var f in frames) f.Dispose();
    }
}
'@

Add-Type -TypeDefinition $source -ReferencedAssemblies System.Drawing
$output = Join-Path $PSScriptRoot 'privatepay-demo.gif'
[PrivatePayDemo]::Save($output)
Write-Output "Created $output"
