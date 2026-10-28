import type { Metadata } from 'next';
import './globals.css';

const title = 'OpenTonton — みんなの都合を、ひとつに。';
const description = 'メール登録不要。30分単位のタイムラインで、みんなが集まれる時間を見つける日程調整サービス。';
const image = {
  url: '/ogp.png',
  width: 1200,
  height: 630,
  type: 'image/png',
  alt: 'OpenTonton — みんなの都合を、ひとつに。',
};

export const metadata: Metadata = {
  metadataBase: new URL('https://opentonton.altneuland.workers.dev'),
  title,
  description,
  robots: { index: false, follow: false },
  icons: { icon: '/favicon.svg' },
  // Keep previews generic. Do not canonicalize event links to the homepage:
  // the original ?event= link must remain the shared destination.
  openGraph: {
    type: 'website',
    locale: 'ja_JP',
    alternateLocale: ['en_US'],
    siteName: 'OpenTonton',
    title: 'OpenTonton — 日程調整 / Find a time together',
    description: description + ' No email required. Find a time that works for everyone.',
    images: [image],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'OpenTonton — 日程調整 / Find a time together',
    description: description + ' No email required. Find a time that works for everyone.',
    images: [{ url: image.url, alt: image.alt }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ja"><body>{children}</body></html>;
}
