import Link from "next/link";

export const metadata = {
  title: "Privacy Policy — PayLane",
  description: "How PayLane collects, uses, and protects your data.",
};

const lastUpdated = "11 May 2026";

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
      <Link href="/dashboard" className="text-sm text-blue-600 hover:underline">
        ← Back to PayLane
      </Link>
      <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
        Privacy Policy
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Last updated: {lastUpdated}
      </p>

      <div className="prose prose-slate mt-8 max-w-none">
        <Section title="Who we are">
          PayLane is a B2B invoice management platform operated by Osiris SG
          (UEN 202410096C). Contact:{" "}
          <a href="mailto:admin@osiris.sg" className="text-blue-600 hover:underline">
            admin@osiris.sg
          </a>
          . This policy explains what data we collect, why, and the choices you
          have.
        </Section>

        <Section title="What we collect">
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong>Account info:</strong> your email, name, and the company
              name you provide during onboarding.
            </li>
            <li>
              <strong>Invoice content:</strong> invoices you create, upload, or
              receive — including invoice numbers, amounts, dates, customer
              names, line items, and any files you attach.
            </li>
            <li>
              <strong>Contacts:</strong> customer and supplier records you add
              manually or import (company name, contact name, email, phone,
              address).
            </li>
            <li>
              <strong>WhatsApp number:</strong> only if you opt in to WhatsApp
              notifications in the app&apos;s settings. We use this number solely to
              send you transactional notifications about your invoices.
            </li>
            <li>
              <strong>Device & usage:</strong> standard logs (IP, browser type,
              timestamps) needed to operate and secure the service.
            </li>
          </ul>
        </Section>

        <Section title="How we use it">
          <ul className="list-disc pl-5 space-y-1">
            <li>To provide the core service — storing, sending, and receiving invoices on your behalf.</li>
            <li>
              To deliver notifications you&apos;ve enabled (in-app, browser push,
              email, and WhatsApp).
            </li>
            <li>To extract structured data from uploaded invoice files using AI.</li>
            <li>To detect abuse and keep the service secure.</li>
          </ul>
          <p className="mt-3">
            We do <strong>not</strong> sell your data, share it with advertisers,
            or use it to train AI models.
          </p>
        </Section>

        <Section title="Third-party processors">
          PayLane uses the following services to operate. They only receive the
          data necessary for their role:
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li><strong>Clerk</strong> — authentication and identity</li>
            <li><strong>Neon</strong> — managed PostgreSQL database hosting</li>
            <li><strong>Vercel</strong> — application hosting and edge network</li>
            <li><strong>Anthropic (Claude)</strong> — AI extraction of invoice and contact data from uploaded files</li>
            <li><strong>Resend</strong> — transactional email delivery</li>
            <li><strong>Meta (WhatsApp Cloud API)</strong> — WhatsApp notifications, only for users who opt in</li>
            <li><strong>Web Push (browser vendors)</strong> — push notification delivery, if subscribed</li>
          </ul>
        </Section>

        <Section title="WhatsApp notifications">
          WhatsApp notifications are strictly opt-in. To enable them you must:
          enter your WhatsApp number in the app&apos;s notification settings,
          actively tick the opt-in box, and save. You can turn off WhatsApp
          notifications at any time from the same settings page. We send only
          transactional messages using pre-approved templates (invoice received,
          payment status updates, due-date reminders). We never send marketing
          messages over WhatsApp.
        </Section>

        <Section title="Data retention">
          We keep your data for as long as your account is active. When you
          delete your account, we delete your personal data within 30 days,
          except where retention is required by law (e.g. tax records). Backups
          are rotated and overwritten within 90 days.
        </Section>

        <Section title="Your rights">
          You can:
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>Access and export your data — contact us</li>
            <li>Correct inaccurate data via the app</li>
            <li>Delete your account and associated data</li>
            <li>Withdraw consent for optional features (e.g. WhatsApp) at any time</li>
            <li>Lodge a complaint with your local data protection authority</li>
          </ul>
          To exercise these, email{" "}
          <a href="mailto:admin@osiris.sg" className="text-blue-600 hover:underline">
            admin@osiris.sg
          </a>
          .
        </Section>

        <Section title="Security">
          Data is encrypted in transit (HTTPS) and at rest. Access to production
          systems is restricted to authorised personnel. We use industry-standard
          authentication via Clerk and never store your password directly.
        </Section>

        <Section title="Children">
          PayLane is a B2B product intended for businesses and is not directed
          to anyone under 18. We do not knowingly collect data from children.
        </Section>

        <Section title="Changes to this policy">
          We may update this policy as the service evolves. Material changes will
          be communicated via email or in-app notice. The &quot;Last updated&quot; date at
          the top of this page always reflects the current version.
        </Section>

        <Section title="Contact">
          Questions about this policy or your data? Email{" "}
          <a href="mailto:admin@osiris.sg" className="text-blue-600 hover:underline">
            admin@osiris.sg
          </a>
          .
        </Section>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <div className="mt-3 text-sm leading-6 text-slate-700">{children}</div>
    </section>
  );
}
