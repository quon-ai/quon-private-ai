import { createFileRoute, Link } from "@tanstack/react-router";

import { LegalShell, Section, Todo } from "@/components/quon/LegalPage";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <LegalShell title="Datenschutzerklärung" current="/privacy">
      <Section n={1} title="Verantwortlicher">
        <p>
          Verantwortlicher im Sinne der Datenschutz-Grundverordnung (DSGVO) ist:{" "}
          <Todo>Anbieter: Name / Firma</Todo>, <Todo>Anschrift</Todo>, <Todo>Kontakt-E-Mail</Todo>.
          Einen Datenschutzbeauftragten haben wir <Todo>benannt / nicht benannt (prüfen)</Todo>.
        </p>
        <p>
          Diese Erklärung beschreibt, welche personenbezogenen Daten wir bei der Nutzung von QUON
          verarbeiten. Ergänzend gilt unsere{" "}
          <Link to="/terms" className="text-quon-indigo hover:underline">
            Nutzungsvereinbarung
          </Link>
          .
        </p>
      </Section>

      <Section n={2} title="Grundprinzip: Zero-Knowledge">
        <p>
          QUON ist so gebaut, dass möglichst wenige personenbezogene Daten auf unseren Servern
          anfallen. Die Erkennung personenbezogener Daten, die Verschlüsselung, die Einbettungen
          (Embeddings), die Dokumentenextraktion und die Texterkennung aus Fotos (OCR) laufen{" "}
          <strong>in Ihrem Browser</strong>. Ihre Chats, Notizen und Dokumente speichern wir
          ausschließlich als für uns nicht entschlüsselbaren Chiffretext. Wir kennen weder Ihr
          Passwort noch Ihre Schlüssel und können diese Inhalte nicht einsehen.
        </p>
      </Section>

      <Section n={3} title="Daten, die wir verarbeiten">
        <p>Serverseitig verarbeiten wir insbesondere:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>E-Mail-Adresse</strong> – zur Kontoführung, E-Mail-Verifizierung,
            Passwort-Wiederherstellung und für dienstbezogene Benachrichtigungen.
          </li>
          <li>
            <strong>Authentifizierungsdaten</strong> – ein aus Ihrem Passwort clientseitig
            abgeleiteter Prüfwert und Zufallswerte (Salts). Das Passwort selbst erreicht unseren
            Server nicht.
          </li>
          <li>
            <strong>Verschlüsseltes Schlüsselmaterial</strong> – Ihr doppelt verschlüsselter
            Hauptschlüssel (per Passwort und per Wiederherstellungsphrase), für uns nicht zu öffnen.
          </li>
          <li>
            <strong>Verschlüsselte Inhaltsblöcke</strong> – Chats, Notizen, Dokumente und Projekte
            als Chiffretext (Zero-Knowledge-Synchronisierung).
          </li>
          <li>
            <strong>Sitzungsdaten</strong> – ein technisch notwendiges, HTTP-only-Cookie zur
            Anmeldung sowie ein CSRF-Token; serverseitig speichern wir nur Hash-Werte.
          </li>
          <li>
            <strong>Zugangs-/Protokolldaten</strong> – u. a. IP-Adresse und Zeitpunkt, insbesondere
            zur Abwehr von Missbrauch und zur Ratenbegrenzung (Rate-Limiting).
          </li>
          <li>
            <strong>Nachweis der Zustimmung</strong> – die von Ihnen akzeptierte Version der
            Nutzungsvereinbarung und der Zeitpunkt der Zustimmung.
          </li>
          <li>
            <strong>KI-Zugangsschlüssel</strong> – ein pro Konto vergebener, verschlüsselt
            gespeicherter Unterschlüssel für den KI-Anbieter (siehe Ziffer 5).
          </li>
        </ul>
      </Section>

      <Section n={4} title="Zwecke und Rechtsgrundlagen">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Bereitstellung des Dienstes, Konto und Synchronisierung –{" "}
            <strong>Art. 6 Abs. 1 lit. b DSGVO</strong> (Vertrag/Nutzungsverhältnis).
          </li>
          <li>
            Sicherheit, Missbrauchs- und Betrugsabwehr, Rate-Limiting, Stabilität –{" "}
            <strong>Art. 6 Abs. 1 lit. f DSGVO</strong> (berechtigtes Interesse).
          </li>
          <li>
            Dienstbezogene E-Mails (Verifizierung, Sicherheit) – <strong>lit. b</strong> bzw.{" "}
            <strong>lit. f</strong>; etwaige nicht zwingende Mitteilungen nur mit Ihrer Einwilligung
            (<strong>lit. a</strong>).
          </li>
          <li>
            Erfüllung rechtlicher Pflichten – <strong>Art. 6 Abs. 1 lit. c DSGVO</strong>.
          </li>
        </ul>
      </Section>

      <Section n={5} title="Übermittlung an KI-Anbieter (Auftrag/Weitergabe)">
        <p>
          Zur Beantwortung Ihrer Anfragen übermitteln wir den <strong>maskierten</strong> Text an
          einen KI-Anbieter (derzeit vermittelt über <Todo>OpenRouter</Todo> bzw. von Ihnen selbst
          hinterlegte Anbieter). Nicht erkannte personenbezogene Daten können dabei mitübermittelt
          werden (siehe Nutzungsvereinbarung Ziffer 6). Für den optionalen Cloud-Abgleich der
          Foto-Texterkennung wird das Bild einmalig an ein Vision-Modell übertragen; dies geschieht
          nur nach Ihrer ausdrücklichen Zustimmung im Einzelfall.
        </p>
        <p>
          Dabei kann eine <strong>Übermittlung in Drittländer</strong> (z. B. USA) erfolgen. Wir
          bemühen uns um geeignete Garantien nach Art. 44 ff. DSGVO (z. B.
          EU-Standardvertragsklauseln, Angemessenheitsbeschluss).{" "}
          <Todo>
            Konkrete Anbieter, Rechtsgrundlage der Drittlandübermittlung und Garantien ergänzen
          </Todo>
          .
        </p>
      </Section>

      <Section n={6} title="Auftragsverarbeiter und Hosting">
        <p>
          Zur Erbringung des Dienstes setzen wir Dienstleister ein, die als Auftragsverarbeiter
          (Art. 28 DSGVO) für uns tätig werden, insbesondere:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>E-Mail-Versand</strong> –{" "}
            <Todo>Brevo (Sendinblue) o. a. – Anbieter/Anschrift</Todo>.
          </li>
          <li>
            <strong>Netzwerk/Zugang</strong> –{" "}
            <Todo>Cloudflare (Tunnel/CDN) – Anbieter/Anschrift</Todo>.
          </li>
          <li>
            <strong>Hosting/Betrieb</strong> – <Todo>Hosting-/Serverstandort und Betreiber</Todo>.
          </li>
        </ul>
        <p>
          <Todo>
            Vollständige Liste der Auftragsverarbeiter, jeweils mit Zweck und Standort, vor dem
            Launch ergänzen und Auftragsverarbeitungsverträge abschließen
          </Todo>
          .
        </p>
      </Section>

      <Section n={7} title="Cookies und lokale Speicherung">
        <p>
          Wir verwenden ein technisch notwendiges Sitzungs-Cookie (HTTP-only) sowie einen
          CSRF-Schutz; diese sind für den Betrieb erforderlich und bedürfen keiner Einwilligung.
          Darüber hinaus speichert QUON Daten <strong>lokal in Ihrem Browser</strong> (u. a.
          verschlüsselte Zwischenspeicher in localStorage/IndexedDB), die Ihr Gerät nicht in
          unverschlüsselter Form verlassen. Tracking- oder Marketing-Cookies setzen wir nicht ein.
        </p>
      </Section>

      <Section n={8} title="Speicherdauer und Löschung">
        <p>
          Kontobezogene Daten speichern wir für die Dauer Ihres Kontos. Sie können Ihr Konto
          jederzeit in den Einstellungen löschen; dabei werden die serverseitig gespeicherten Daten
          entfernt. Kurzlebige Daten wie Sitzungen und E-Mail-Token werden nach Ablauf automatisch
          bereinigt. Protokolldaten werden nur so lange gespeichert, wie es für die genannten Zwecke
          erforderlich ist. <Todo>Konkrete Aufbewahrungsfristen ergänzen</Todo>.
        </p>
      </Section>

      <Section n={9} title="Ihre Rechte">
        <p>Sie haben nach der DSGVO das Recht auf</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Auskunft (Art. 15), Berichtigung (Art. 16) und Löschung (Art. 17);</li>
          <li>Einschränkung der Verarbeitung (Art. 18) und Datenübertragbarkeit (Art. 20);</li>
          <li>
            Widerspruch gegen Verarbeitungen auf Grundlage berechtigter Interessen (Art. 21) sowie
            Widerruf erteilter Einwilligungen mit Wirkung für die Zukunft (Art. 7 Abs. 3).
          </li>
        </ul>
        <p>
          Zur Ausübung genügt eine Nachricht an <Todo>Kontakt-E-Mail</Todo>. Hinweis: Aufgrund des
          Zero-Knowledge-Modells können wir verschlüsselte Inhalte nicht entschlüsseln; Auskunft und
          Löschung beziehen sich auf die uns tatsächlich zugänglichen Daten.
        </p>
        <p>
          Ihnen steht zudem ein Beschwerderecht bei einer Datenschutz-Aufsichtsbehörde zu (Art. 77
          DSGVO), etwa der für <Todo>zuständige Aufsichtsbehörde</Todo>.
        </p>
      </Section>

      <Section n={10} title="Änderungen dieser Datenschutzerklärung">
        <p>
          Wir passen diese Datenschutzerklärung an, wenn sich der Dienst oder die Rechtslage ändert.
          Es gilt jeweils die auf dieser Seite veröffentlichte Fassung.
        </p>
      </Section>
    </LegalShell>
  );
}
