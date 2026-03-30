import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'IMU Balance Board',
  description: 'Train and track your balance with real-time IMU posturography',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
