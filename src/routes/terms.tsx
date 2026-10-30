import { createFileRoute, Link } from "@tanstack/react-router";

import { LegalShell, Section, Todo } from "@/components/quon/LegalPage";

export const Route = createFileRoute("/terms")({
  component: TermsPage,
});

function TermsPage() {
  return (
    <LegalShell title="Nutzungsvereinbarung" current="/terms">
      <Section n={1} title="Geltungsbereich und Anbieter">
        <p>
          Diese Nutzungsvereinbarung regelt die Nutzung des Dienstes „QUON" (nachfolgend „QUON" oder
          „der Dienst"), der von <Todo>Anbieter: Name / Firma</Todo>, <Todo>Anschrift</Todo>{" "}
          (nachfolgend „Anbieter", „wir") betrieben wird. Sie gilt für alle Personen, die ein
          Nutzerkonto anlegen und den Dienst nutzen (nachfolgend „Sie", „Nutzer").
        </p>
        <p>
          Mit der Registrierung eines Kontos und dem Setzen des entsprechenden Häkchens bestätigen
          Sie, dass Sie diese Vereinbarung gelesen haben und ihr zustimmen. Wenn Sie nicht
          zustimmen, können Sie QUON nicht nutzen.
        </p>
        <p>
          QUON befindet sich in einer geschlossenen Vorabphase (Beta) und wird derzeit nur mit
          Einladung bereitgestellt. Die Nutzung ist Personen ab 18 Jahren vorbehalten.
        </p>
      </Section>

      <Section n={2} title="Beschreibung des Dienstes">
        <p>
          QUON ist ein Datenschutz-Gateway für die Nutzung von KI-Sprachmodellen (LLMs). Bevor Ihre
          Eingaben an einen KI-Anbieter weitergeleitet werden, werden personenbezogene Daten (z. B.
          Namen, E-Mail-Adressen, Telefonnummern, IBANs, Beträge) <em>auf Ihrem Gerät</em> erkannt
          und durch typisierte Platzhalter (z. B. <code>[PERSON_1]</code>) ersetzt. Die Antwort des
          Modells wird lokal wieder mit Ihren Originalwerten zusammengeführt.
        </p>
        <p>
          Chats, Notizen (Memory) und Dokumente werden Ende-zu-Ende verschlüsselt in Ihrem Browser
          und liegen auf unseren Servern ausschließlich als für uns unlesbarer Chiffretext
          („Zero-Knowledge"). Weitere technische Einzelheiten beschreibt unsere{" "}
          <Link to="/privacy" className="text-quon-indigo hover:underline">
            Datenschutzerklärung
          </Link>
          .
        </p>
      </Section>

      <Section n={3} title="Vorabversion – keine Zusicherung bestimmter Eigenschaften">
        <p>
          QUON wird Ihnen im Rahmen einer Beta-/Vorabversion „wie besehen" und „wie verfügbar" zur
          Verfügung gestellt. Der Funktionsumfang kann sich ändern; einzelne Funktionen können
          fehlerhaft sein, ausfallen oder ohne Vorankündigung entfernt werden. Eine bestimmte
          Verfügbarkeit, Fehlerfreiheit oder Eignung für einen bestimmten Zweck wird nicht
          zugesichert.
        </p>
      </Section>

      <Section n={4} title="Konto, Zugangsdaten und Sicherheit">
        <p>
          Für die Nutzung ist ein Konto mit einer gültigen E-Mail-Adresse erforderlich. Sie sind
          verpflichtet, wahrheitsgemäße Angaben zu machen, Ihre Zugangsdaten geheim zu halten und
          uns unautorisierte Nutzung Ihres Kontos unverzüglich mitzuteilen. Sie sind für alle
          Aktivitäten verantwortlich, die über Ihr Konto erfolgen.
        </p>
      </Section>

      <Section n={5} title="Verschlüsselung und Wiederherstellungsphrase">
        <p>
          QUON ist so gestaltet, dass wir Ihr Passwort und Ihre Schlüssel nicht kennen. Ihre Daten
          werden mit einem Schlüssel verschlüsselt, der aus Ihrem Passwort abgeleitet wird. Bei der
          Registrierung erhalten Sie eine <strong>12-Wort-Wiederherstellungsphrase</strong>.
        </p>
        <p>
          <strong className="text-quon-text">Wichtig:</strong> Wenn Sie Ihr Passwort vergessen und
          Ihre Wiederherstellungsphrase verlieren, können weder Sie noch wir Ihre Daten
          wiederherstellen – sie sind dann unwiederbringlich verloren. Sie sind allein für die
          sichere und vertrauliche Aufbewahrung Ihrer Wiederherstellungsphrase verantwortlich. Jede
          Person, die diese Phrase kennt, kann auf Ihre Daten zugreifen.
        </p>
      </Section>

      <Section n={6} title="Grenzen der PII-Erkennung (Restrisiko)">
        <p>
          Die automatische Erkennung personenbezogener Daten arbeitet nach dem Stand der Technik,
          ist jedoch <strong>nicht fehlerfrei</strong>. Es kann vorkommen, dass einzelne
          personenbezogene Daten nicht erkannt werden und dadurch in unmaskierter Form an den
          KI-Anbieter gelangen, oder dass Begriffe fälschlich maskiert werden.
        </p>
        <p>
          QUON reduziert das Risiko der Weitergabe personenbezogener Daten, kann eine vollständige
          Erkennung oder Maskierung jedoch nicht garantieren. Prüfen Sie besonders sensible Eingaben
          vor dem Absenden selbst (z. B. über den Freigabemodus „Review") und geben Sie keine
          Inhalte ein, deren Offenlegung Sie unter keinen Umständen hinnehmen können.
        </p>
      </Section>

      <Section n={7} title="Einbindung von KI-Anbietern und Datenübermittlung">
        <p>
          Zur Erzeugung von Antworten leitet QUON den maskierten Text an einen KI-Anbieter weiter
          (derzeit vermittelt über <Todo>OpenRouter</Todo> bzw. von Ihnen selbst hinterlegte
          Anbieter). Für diese Anbieter gelten deren eigene Nutzungs- und Datenschutzbestimmungen.
          Auf die Verarbeitung durch diese Drittanbieter haben wir nur eingeschränkten Einfluss.
        </p>
        <p>
          Sie erkennen an, dass der (maskierte) Inhalt Ihrer Eingaben zur Beantwortung an solche
          Drittanbieter übermittelt wird. Nicht erkannte personenbezogene Daten (siehe Ziffer 6)
          können dabei mitübermittelt werden. Einzelheiten zur Übermittlung – auch in Drittländer –
          finden Sie in der{" "}
          <Link to="/privacy" className="text-quon-indigo hover:underline">
            Datenschutzerklärung
          </Link>
          .
        </p>
      </Section>

      <Section n={8} title="Zulässige Nutzung">
        <p>Sie verpflichten sich, QUON nicht zu nutzen, um</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>gegen geltendes Recht oder Rechte Dritter zu verstoßen;</li>
          <li>
            rechtswidrige, beleidigende, diskriminierende oder schädigende Inhalte zu erstellen oder
            zu verbreiten;
          </li>
          <li>
            personenbezogene Daten Dritter ohne die erforderliche Rechtsgrundlage oder Einwilligung
            zu verarbeiten;
          </li>
          <li>
            die Sicherheit, Integrität oder Verfügbarkeit des Dienstes zu beeinträchtigen (z. B.
            durch automatisierte Massenzugriffe, Umgehung von Limits oder Sicherheitsmaßnahmen).
          </li>
        </ul>
        <p>
          Für Inhalte, die Sie eingeben, verarbeiten oder speichern, sind Sie selbst verantwortlich.
          Soweit Sie personenbezogene Daten Dritter verarbeiten, sind Sie hierfür der
          Verantwortliche im Sinne der Datenschutzgesetze.
        </p>
      </Section>

      <Section n={9} title="Keine Fachberatung – Prüfpflicht bei KI-Ergebnissen">
        <p>
          QUON und die eingebundenen KI-Modelle liefern keine Rechts-, Steuer-, medizinische oder
          sonstige Fachberatung. KI-Antworten können falsch, unvollständig oder irreführend sein.
          Verlassen Sie sich nicht ungeprüft auf die Ergebnisse und ziehen Sie bei wichtigen
          Entscheidungen qualifizierten fachlichen Rat hinzu.
        </p>
      </Section>

      <Section n={10} title="Verfügbarkeit und Änderungen des Dienstes">
        <p>
          Wir bemühen uns um einen möglichst störungsfreien Betrieb, schulden jedoch keine bestimmte
          Verfügbarkeit. Wir dürfen den Dienst warten, weiterentwickeln, einschränken oder –
          insbesondere während der Beta-Phase – ganz einstellen. Wesentliche Änderungen kündigen
          wir, soweit zumutbar, mit angemessener Frist an.
        </p>
      </Section>

      <Section n={11} title="Datenschutz">
        <p>
          Die Verarbeitung personenbezogener Daten richtet sich nach unserer{" "}
          <Link to="/privacy" className="text-quon-indigo hover:underline">
            Datenschutzerklärung
          </Link>
          . Serverseitig verarbeiten wir insbesondere Ihre E-Mail-Adresse (Konto, Verifizierung,
          Benachrichtigungen) sowie verschlüsselte Datenblöcke, die für uns nicht lesbar sind. Im
          Übrigen gilt das in Ziffer 2 und 7 beschriebene Zero-Knowledge-Modell.
        </p>
      </Section>

      <Section n={12} title="Haftung">
        <p>
          Wir haften unbeschränkt bei Vorsatz und grober Fahrlässigkeit sowie für Schäden aus der
          Verletzung des Lebens, des Körpers oder der Gesundheit. Bei einfacher Fahrlässigkeit
          haften wir nur bei der Verletzung einer wesentlichen Vertragspflicht (Kardinalpflicht) und
          begrenzt auf den vertragstypischen, vorhersehbaren Schaden.
        </p>
        <p>
          Im Übrigen ist die Haftung ausgeschlossen. Dies gilt insbesondere – im Rahmen des
          gesetzlich Zulässigen – für Schäden infolge nicht erkannter personenbezogener Daten
          (Ziffer 6), des Verlusts der Wiederherstellungsphrase (Ziffer 5) sowie für die
          Verarbeitung durch Drittanbieter (Ziffer 7). Da QUON in der Beta-Phase unentgeltlich
          bereitgestellt wird, gelten ergänzend die gesetzlichen Haftungserleichterungen für die
          unentgeltliche Überlassung. <Todo>Haftungsklausel anwaltlich prüfen</Todo>.
        </p>
      </Section>

      <Section n={13} title="Laufzeit, Kündigung und Kontolöschung">
        <p>
          Die Vereinbarung läuft auf unbestimmte Zeit. Sie können Ihr Konto jederzeit über die
          Einstellungen löschen; dabei werden Ihre serverseitig gespeicherten Daten entfernt. Wir
          dürfen Ihr Konto bei Verstößen gegen diese Vereinbarung oder bei Einstellung des Dienstes
          sperren oder kündigen. Ziffern, die ihrer Natur nach fortgelten (z. B. Haftung), bleiben
          nach Beendigung wirksam.
        </p>
      </Section>

      <Section n={14} title="Änderungen dieser Vereinbarung">
        <p>
          Wir können diese Nutzungsvereinbarung anpassen, etwa bei Änderungen des Dienstes oder der
          Rechtslage. Über wesentliche Änderungen informieren wir Sie rechtzeitig (z. B. per E-Mail
          oder in der App). Widersprechen Sie nicht innerhalb der genannten Frist oder nutzen Sie
          den Dienst weiter, gilt die geänderte Fassung als angenommen.
        </p>
      </Section>

      <Section n={15} title="Schlussbestimmungen">
        <p>
          Es gilt das Recht der Bundesrepublik Deutschland unter Ausschluss des UN-Kaufrechts.
          Zwingende verbraucherschützende Vorschriften Ihres Wohnsitzstaates bleiben unberührt.
          Gerichtsstand ist, soweit zulässig, <Todo>Sitz des Anbieters</Todo>.
        </p>
        <p>
          Sollte eine Bestimmung dieser Vereinbarung unwirksam sein oder werden, bleibt die
          Wirksamkeit der übrigen Bestimmungen unberührt.
        </p>
      </Section>

      <Section n={16} title="Kontakt">
        <p>
          Anbieter und verantwortliche Stelle: <Todo>Name / Firma, Anschrift</Todo>. Kontakt:{" "}
          <Todo>Kontakt-E-Mail</Todo>. Ein vollständiges Impressum finden Sie unter{" "}
          <Link to="/imprint" className="text-quon-indigo hover:underline">
            Impressum
          </Link>
          .
        </p>
      </Section>
    </LegalShell>
  );
}
