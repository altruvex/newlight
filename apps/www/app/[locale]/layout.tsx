import { Providers } from "@/components/providers";
import { RegisterServiceWorker } from "@/components/register-sw";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { pickMessages } from '@/i18n/client-namespaces';
import { routing } from '@/i18n/routing';
import { constructMetadata } from "@/lib/metadata";
import { cn } from "@/lib/utils";
import { SupportedLanguage } from "@/types";
import { Metadata } from "next";
import { NextIntlClientProvider, hasLocale } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { Inter, Playfair_Display, Almarai } from "next/font/google";
import { notFound } from "next/navigation";
import "../globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-playfair",
});

const almarai = Almarai({
  weight: ["400", "700"],
  subsets: ["arabic"],
  display: "swap",
  variable: "--font-almarai",
})

// Both locales are known at build time. Declaring them (and calling setRequestLocale below)
// lets next-intl take the locale from the URL instead of reading request headers, which is
// what allows the pages beneath this layout to be statically rendered and cached.
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }))
}

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params

  const metadata = constructMetadata({
    locale: locale as SupportedLanguage
  })

  return {
    ...metadata,
    manifest: "/manifest.json",
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: "New Light",
    },
    icons: {
      icon: [
        { url: "/favicon.svg", type: "image/svg+xml" },
        { url: "/favicon.ico" },
        { url: "/favicon-96x96.png", sizes: "96x96", type: "image/png" },
        { url: "/web-app-manifest-192x192.png", sizes: "192x192", type: "image/png" },
        { url: "/web-app-manifest-512x512.png", sizes: "512x512", type: "image/png" },
      ],
      apple: [
        { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
      ],
    },
  }
}

export default async function RootLayout({
  children,
  params
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale)

  // Only the namespaces client components read are serialised into the page payload; server
  // components resolve theirs on the server. test/client-namespaces.test.ts keeps the list honest.
  const messages = pickMessages(await getMessages())

  return (
      <html lang={locale} suppressHydrationWarning dir={locale === "ar" ? "rtl" : "ltr"} className={cn(inter.variable, playfair.variable, almarai.variable)}>
        <body className="overflow-x-hidden scroll-smooth selection:bg-primary/20" suppressHydrationWarning>
          <script
            suppressHydrationWarning
            dangerouslySetInnerHTML={{
              __html: `
              try {
                const theme = localStorage.getItem('theme-preference');
                const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                const shouldBeDark = theme === 'dark' || (!theme && prefersDark);
                if (shouldBeDark) {
                  document.documentElement.classList.add('dark');
                } else {
                  document.documentElement.classList.remove('dark');
                }
              } catch (e) {}
            `,
            }}
          />
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
            storageKey="theme-preference"
          >
            <NextIntlClientProvider messages={messages}>
              <Providers>
                {children}
                <RegisterServiceWorker />
              </Providers>
              <Toaster />
            </NextIntlClientProvider>
          </ThemeProvider>
        </body>
      </html>
  );
}
