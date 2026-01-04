import './globals.css';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>PRUN Production Optimizer</title>
      </head>
      <body>
        <nav className="terminal-nav">
          <a href="/">Main Report</a>
          <a href="/best-recipes">Best Recipes</a>
          <a href="/best-recipes-history">Recipe History</a>
          <a href="/xit-converter">XIT Converter</a>
        </nav>
        <main className="terminal-container">
          {children}
        </main>
      </body>
    </html>
  );
}
