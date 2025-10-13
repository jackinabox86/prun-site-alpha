export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <nav style={{
          padding: "12px 24px",
          backgroundColor: "#f8f9fa",
          borderBottom: "1px solid #dee2e6",
          fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
        }}>
          <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
            <a href="/" style={{ textDecoration: "none", color: "#007bff", fontWeight: 600 }}>
              Home
            </a>
            <a href="/best-recipes" style={{ textDecoration: "none", color: "#007bff", fontWeight: 600 }}>
              Best Recipes
            </a>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
