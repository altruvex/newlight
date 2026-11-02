import { ThemeProvider } from "@/components/theme-provider";
import { cn } from "@/lib/utils";
import { Almarai, Roboto } from "next/font/google";
import "./globals.css";
import { Provider } from "@/components/providers";
import { Toaster } from "@/components/ui/sonner";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "NewLight Admin", template: "%s · NewLight Admin" },
  robots: { index: false, follow: false },
};

const roboto = Roboto({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-roboto",
});

const almarai = Almarai({
  weight: ["400", "700"],
  subsets: ["arabic"],
  display: "swap",
  variable: "--font-almarai",
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={cn(roboto.variable, almarai.variable)} suppressHydrationWarning>
      <body className="antialiased" suppressHydrationWarning>
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
          <Provider>
            {children}

            <Toaster />
          </Provider>
        </ThemeProvider>
      </body>
    </html>
  );
}
