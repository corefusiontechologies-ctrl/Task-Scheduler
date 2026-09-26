import './globals.css';

export const metadata = {
  title: 'Task Scheduler',
  description: 'Team scheduling and client portal',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
 