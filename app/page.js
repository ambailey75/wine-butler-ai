export default function Home() {
  return (
    <main style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#1a0a0e',
      fontFamily: 'Georgia, serif',
      color: '#f5f0eb',
      padding: '2rem',
      textAlign: 'center',
    }}>
      <div style={{ marginBottom: '1.5rem', fontSize: '3rem' }}>🍷</div>

      <h1 style={{
        fontSize: 'clamp(2rem, 5vw, 3.5rem)',
        fontWeight: 'bold',
        color: '#c9a84c',
        marginBottom: '1rem',
        letterSpacing: '0.05em',
      }}>
        Cellar AI
      </h1>

      <p style={{
        fontSize: 'clamp(1rem, 2.5vw, 1.35rem)',
        color: '#d4b8be',
        maxWidth: '520px',
        lineHeight: '1.7',
        marginBottom: '2.5rem',
      }}>
        Your personal wine inventory tracker and AI sommelier. Track your collection,
        discover drinking windows, and get expert pairing recommendations — all in one place.
      </p>

      <div style={{
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(201,168,76,0.3)',
        borderRadius: '12px',
        padding: '1.5rem 2rem',
        maxWidth: '420px',
        width: '100%',
      }}>
        <p style={{
          fontSize: '0.95rem',
          color: '#c9a84c',
          fontFamily: 'Arial, sans-serif',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          marginBottom: '0.5rem',
        }}>
          Coming Soon
        </p>
        <p style={{
          fontSize: '0.9rem',
          color: '#a08890',
          fontFamily: 'Arial, sans-serif',
          margin: 0,
        }}>
          Private beta launching in 2026. Built for serious collectors.
        </p>
      </div>
    </main>
  )
}
