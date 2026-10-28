import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'OpenTonton — みんなの都合を、ひとつに。',description:'メール登録不要。30分単位のタイムラインで、みんなが集まれる時間を見つける日程調整サービス。',robots:{index:false,follow:false},icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ja"><body>{children}</body></html>;}
