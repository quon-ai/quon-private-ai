import { createFileRoute, Link } from "@tanstack/react-router";

import { LegalShell, Section, Todo } from "@/components/quon/LegalPage";

export const Route = createFileRoute("/imprint")({
  component: ImprintPage,
});

function ImprintPage() {
  return (
    <LegalShell title="Impressum" current="/imprint">
      <Section n={1} title="Angaben gemäß § 5 DDG">
        <p>
          <Todo>Anbieter: Name / Firma</Todo>
          <br />
          <Todo>Straße und Hausnummer</Todo>
          <br />
          <Todo>PLZ und Ort</Todo>
          <br />
          <Todo>Land</Todo>
        </p>
        <p>
          <Todo>Bei juristischen Personen: Rechtsform und Vertretungsberechtigte(r)</Todo>.{" "}
          <Todo>Registergericht und Registernummer, falls vorhanden</Todo>.
        </p>
      </Section>

      <Section n={2} title="Kontakt">
        <p>
          E-Mail: <Todo>Kontakt-E-Mail</Todo>
          <br />
          Telefon: <Todo>Telefonnummer (optional)</Todo>
        </p>
      </Section>

      <Section n={3} title="Umsatzsteuer">
        <p>
          <Todo>
            Umsatzsteuer-Identifikationsnummer gemäß § 27 a UStG, falls vorhanden – sonst diesen
            Abschnitt entfernen
          </Todo>
          .
        </p>
      </Section>

      <Section n={4} title="Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV">
        <p>
          <Todo>Name und Anschrift der verantwortlichen Person</Todo>.
        </p>
      </Section>

      <Section n={5} title="EU-Streitschlichtung">
        <p>
          Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit:{" "}
          <span className="text-quon-text">https://ec.europa.eu/consumers/odr/</span>. Unsere
          E-Mail-Adresse finden Sie oben.
        </p>
      </Section>

      <Section n={6} title="Verbraucherstreitbeilegung / Universalschlichtungsstelle">
        <p>
          Wir sind <Todo>nicht bereit / nicht verpflichtet</Todo>, an Streitbeilegungsverfahren vor
          einer Verbraucherschlichtungsstelle teilzunehmen.{" "}
          <Todo>Formulierung je nach tatsächlicher Bereitschaft anpassen</Todo>.
        </p>
      </Section>

      <Section n={7} title="Datenschutz">
        <p>
          Informationen zur Verarbeitung personenbezogener Daten finden Sie in unserer{" "}
          <Link to="/privacy" className="text-quon-indigo hover:underline">
            Datenschutzerklärung
          </Link>
          .
        </p>
      </Section>
    </LegalShell>
  );
}
