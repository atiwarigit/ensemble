"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <div style={{ maxWidth: 420, textAlign: "center", padding: 24 }}>
          <h1 style={{ fontSize: 18 }}>Ensemble couldn&apos;t load</h1>
          <p style={{ color: "#666", fontSize: 14 }}>Nothing was changed. Reload to try again.</p>
          {error.digest && <code style={{ fontSize: 12 }}>Reference {error.digest}</code>}
          <div style={{ marginTop: 16 }}>
            <button onClick={reset} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #ccc", background: "white", cursor: "pointer" }}>
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
