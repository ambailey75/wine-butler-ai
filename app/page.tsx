import Image from 'next/image'
import Link from 'next/link'

export default function Home() {
  return (
    <div className="min-h-screen bg-background font-sans text-foreground">

      {/* Hero */}
      <section
        className="relative flex w-full flex-col items-center justify-end overflow-hidden pb-20"
        style={{ minHeight: '100vh' }}
      >
        <Image
          src="/images/vineyard-rows.png"
          alt="Vineyard rows at sunset"
          fill
          style={{ objectFit: 'cover', objectPosition: 'center 30%' }}
          sizes="100vw"
          priority
        />
        <div
          className="absolute inset-x-0 bottom-0"
          style={{
            height: '25%',
            background:
              'linear-gradient(to bottom, rgba(45, 27, 30, 0) 0%, rgba(45, 27, 30, 0.5) 100%)',
          }}
        />
        <div className="relative z-10 flex flex-col items-center px-6 text-center">
          <Image
            src="/wine-butler-ai-logo.png"
            alt="Wine Butler AI"
            width={220}
            height={220}
            className="mb-6 drop-shadow-xl"
            priority
          />
          <h1
            className="mb-4 font-bold text-white drop-shadow-lg"
            style={{
              fontFamily: 'Georgia, serif',
              fontSize: 'clamp(2.25rem, 6vw, 4rem)',
              letterSpacing: '0.02em',
            }}
          >
            Meet Your Wine Butler
          </h1>
          <p
            className="mb-10 text-white/80"
            style={{
              fontFamily: 'Arial, sans-serif',
              fontSize: 'clamp(1rem, 2.5vw, 1.25rem)',
              maxWidth: '480px',
              lineHeight: '1.7',
            }}
          >
            An AI sommelier that knows your cellar
          </p>
          <Link
            href="/login"
            className="inline-block rounded-md px-9 py-3.5 text-sm font-semibold uppercase tracking-widest transition-opacity hover:opacity-90"
            style={{ background: '#C9A84C', color: '#2D1B1E' }}
          >
            Get Started
          </Link>
        </div>
      </section>

      {/* Feature cards — row 1 */}
      <section className="bg-background px-6 py-16">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-6 sm:grid-cols-3">
            <FeatureCard
              image="/images/cellar-tunnel.png"
              title="Track Your Collection"
              body="Every bottle catalogued with producer, vintage, region, and drinking window. Import from a spreadsheet or snap a label photo."
            />
            <FeatureCard
              image="/images/wine-glasses-vineyard.png"
              title="Get Expert Guidance"
              body="Ask your AI butler anything. Pairing recommendations, drinking window advice, and reorder suggestions tailored to your cellar."
            />
            <FeatureCard
              image="/images/modern-cellar.png"
              title="Never Miss a Peak"
              body="Automated alerts when bottles are entering their prime. Know exactly when to open each wine for the best experience."
            />
          </div>

          {/* Feature cards — row 2 */}
          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <FeatureCard
              image="/images/grapes-vineyard.png"
              title="Import from Anything"
              body="Upload a spreadsheet, a PDF invoice, or a photo of a wine label. Wine Butler AI extracts and maps every field automatically."
            />
            <FeatureCard
              image="/images/wine-barrel-still.png"
              title="Know What You're Drinking"
              body="Log tasting notes, track bottles consumed, and build a personal drinking history that informs every future recommendation."
            />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-background px-6 py-8 text-center text-sm text-muted-foreground">
        © 2026 Bailey Applied Intelligence · winebutlerai.com
      </footer>
    </div>
  )
}

function FeatureCard({
  image,
  title,
  body,
}: {
  image: string
  title: string
  body: string
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="relative h-48">
        <Image src={image} alt={title} fill className="object-cover" />
      </div>
      <div className="p-5">
        <h3
          className="mb-2 text-lg font-semibold text-foreground"
          style={{ fontFamily: 'Georgia, serif' }}
        >
          {title}
        </h3>
        <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </div>
  )
}
