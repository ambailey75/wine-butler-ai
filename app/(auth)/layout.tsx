import Image from 'next/image'

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <main style={{ position: 'relative', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
      {/* Vineyard background */}
      <div style={{ position: 'fixed', inset: 0 }}>
        <Image
          src="/images/vineyard-rows.png"
          alt=""
          fill
          style={{ objectFit: 'cover', objectPosition: 'center' }}
          sizes="100vw"
          priority
        />
      </div>

      {/* Frosted card */}
      <div
        style={{
          position: 'relative',
          zIndex: 10,
          width: '100%',
          maxWidth: '420px',
          background: 'rgba(26, 5, 16, 0.92)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderRadius: '16px',
          border: '1px solid rgba(201, 168, 76, 0.4)',
          padding: '2.5rem 2.25rem',
          boxShadow: '0 25px 60px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <Image
            src="/wine-butler-ai-logo.png"
            alt="Wine Butler AI"
            width={200}
            height={200}
            style={{ margin: '0 auto 1rem' }}
            priority
          />
          <h1
            style={{
              fontSize: '1.75rem',
              fontWeight: 'bold',
              letterSpacing: '0.05em',
              color: '#C9A84C',
              fontFamily: 'Georgia, serif',
              margin: 0,
            }}
          >
            Wine Butler AI
          </h1>
        </div>
        {children}
      </div>
    </main>
  )
}
