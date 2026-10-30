"""The 50-case QUON evaluation corpus.

Each case declares:
  - ``must_anonymize``      values that MUST be removed (plain string or ``{value, type}``)
  - ``must_not_anonymize``  values that MUST still be present (false-positive guard)
  - ``pair_id`` (optional)  links DE/EN mirror scenarios for side-by-side reporting
  - ``policy`` (optional)   ``strict_private`` | ``public_ok`` | ``amount_debate``

Curation note: ``must_not_anonymize`` only lists tokens that appear in the text
*independently* of any redacted span. Company names that occur solely inside an
email domain (e.g. "BMW" in p.hoffmann@bmw.de) are intentionally omitted — they
legitimately vanish when the email is redacted, so asserting their presence
would be a guaranteed false failure rather than a real false positive.
"""

from __future__ import annotations

TEST_CASES: list[dict] = [
    # ----------------------------- GERMAN (25) -----------------------------
    {
        "id": "DE-001",
        "language": "de",
        "category": "business_email",
        "input": (
            "Hallo Herr Müller, anbei die Unterlagen für unser Meeting\n"
            "am 12. März 2025. Bitte leiten Sie diese an\n"
            "Frau Dr. Petra Hoffmann (p.hoffmann@bmw.de) weiter.\n"
            "Das Budget beträgt 2,3 Mio. €.\n"
            "Mit freundlichen Grüßen, Thomas Berger"
        ),
        "must_anonymize": [
            "Müller", "Petra Hoffmann", "p.hoffmann@bmw.de",
            "2,3 Mio. €", "12. März 2025", "Thomas Berger",
        ],
        "must_not_anonymize": ["Meeting"],
    },
    {
        "id": "DE-002",
        "language": "de",
        "category": "hr_context",
        "input": (
            "Die Bewerberin Anna-Lena Schulz (geboren am 14.07.1992\n"
            "in Hamburg) bewirbt sich als Senior Engineer.\n"
            "Gehalt: 85.000 € brutto.\n"
            "Kontakt: 0176 9876543, a.schulz@gmail.com"
        ),
        "must_anonymize": [
            "Anna-Lena Schulz", "14.07.1992", "85.000 €",
            "0176 9876543", "a.schulz@gmail.com",
        ],
        "must_not_anonymize": ["Senior Engineer", "Hamburg"],
    },
    {
        "id": "DE-003",
        "language": "de",
        "category": "financial_transfer",
        "input": (
            "Bitte überweisen Sie 47.500 € an Max Mustermann,\n"
            "IBAN DE89 3704 0044 0532 0130 00, BIC COBADEFFXXX,\n"
            "Commerzbank. Verwendungszweck: Rechnung 2025-0342."
        ),
        "must_anonymize": [
            "Max Mustermann", "DE89 3704 0044 0532 0130 00", "47.500 €",
        ],
        "must_not_anonymize": ["COBADEFFXXX", "Commerzbank", "Rechnung 2025-0342"],
    },
    {
        "id": "DE-004",
        "language": "de",
        "category": "medical",
        "pair_id": "medical_record",
        "input": (
            "Patient: Klaus-Dieter Wernecke, geb. 03.11.1965,\n"
            "AOK Versichertennummer A123456789.\n"
            "Hausarzt: Dr. Sabine Lorenz, Tel: 030 12345678,\n"
            "Hauptstraße 42, 10115 Berlin."
        ),
        "must_anonymize": [
            "Klaus-Dieter Wernecke", "03.11.1965", "A123456789",
            "Sabine Lorenz", "030 12345678",
        ],
        "must_not_anonymize": ["AOK", "Berlin", "Hauptstraße 42"],
    },
    {
        "id": "DE-005",
        "language": "de",
        "category": "internal_project",
        "input": (
            "Das neue QUON System wird von Siemens Energy eingesetzt.\n"
            "Die SCADA-Software läuft auf Kubernetes.\n"
            "Dokumentation: confluence.intern.de/quon"
        ),
        "must_anonymize": ["confluence.intern.de/quon"],
        "must_not_anonymize": ["QUON", "Siemens Energy", "SCADA", "Kubernetes"],
    },
    {
        "id": "DE-006",
        "language": "de",
        "category": "generic_communication",
        "input": (
            "Bitte schicke mir die Unterlagen bis Freitag.\n"
            "Das Team hat gute Arbeit geleistet.\n"
            "Der Bericht liegt im SharePoint.\n"
            "Wir sehen uns beim nächsten Sprint Review."
        ),
        "must_anonymize": [],
        "must_not_anonymize": ["Unterlagen", "Team", "SharePoint", "Sprint Review"],
    },
    {
        "id": "DE-007",
        "language": "de",
        "category": "legal_contract",
        "input": (
            "Dieser Vertrag wird geschlossen zwischen\n"
            "Hans Georg Fischer (geb. 22.08.1978,\n"
            "Steuer-ID 12 345 678 901) wohnhaft in\n"
            "Musterstraße 7, 80331 München und der\n"
            "Mustermann GmbH. Unterzeichnet am 1. Januar 2025."
        ),
        "must_anonymize": [
            "Hans Georg Fischer", "22.08.1978", "12 345 678 901", "1. Januar 2025",
        ],
        "must_not_anonymize": ["Mustermann GmbH", "München", "Musterstraße"],
    },
    {
        "id": "DE-008",
        "language": "de",
        "category": "it_ticket",
        "input": (
            "[TICKET-4421] Gemeldet von: Klaus Fischer\n"
            "(k.fischer@firma.de, Durchwahl 221).\n"
            "Problem: API /v2/users gibt 500 zurück.\n"
            "Zugewiesen an: dev-team@firma.de\n"
            "Priorität: HOCH – Go-Live am 15. April 2025"
        ),
        "must_anonymize": ["Klaus Fischer", "k.fischer@firma.de", "15. April 2025"],
        "must_not_anonymize": ["TICKET-4421", "dev-team@firma.de", "/v2/users"],
    },
    {
        "id": "DE-009",
        "language": "de",
        "category": "sales_email",
        "input": (
            "Sehr geehrte Frau Schneider, vielen Dank für Ihr\n"
            "Interesse an unserem Angebot. Der Gesamtpreis beträgt\n"
            "128.500 € netto. Ansprechpartner: Felix Wagner,\n"
            "f.wagner@vertrieb.de, +49 89 44556677.\n"
            "Angebot gültig bis 30. Juni 2025."
        ),
        "must_anonymize": [
            "Schneider", "Felix Wagner", "f.wagner@vertrieb.de",
            "+49 89 44556677", "128.500 €", "30. Juni 2025",
        ],
        "must_not_anonymize": [],
    },
    {
        "id": "DE-010",
        "language": "de",
        "category": "meeting_notes",
        "input": (
            "Protokoll – Steuerungskomitee 14.03.2025\n"
            "Teilnehmer: Christoph Maier, Sandra Klein, Rolf Bauer\n"
            "Beschlossen: Budget 340.000 € freigegeben.\n"
            "Nächstes Meeting: 28. März, Raum 4B, Berlin HQ"
        ),
        "must_anonymize": [
            "14.03.2025", "Christoph Maier", "Sandra Klein",
            "Rolf Bauer", "340.000 €", "28. März",
        ],
        "must_not_anonymize": ["Berlin HQ", "Raum 4B"],
    },
    {
        "id": "DE-011",
        "language": "de",
        "category": "insurance",
        "pair_id": "insurance_health",
        "input": (
            "Versicherungsnehmer: Maria Gonzalez,\n"
            "Versicherungsscheinnummer VN-2024-88421.\n"
            "Beitrag: 234,50 € monatlich.\n"
            "Nächste Fälligkeit: 1. März 2025.\n"
            "Kontakt: m.gonzalez@web.de, 0151 88776655"
        ),
        "must_anonymize": [
            "Maria Gonzalez", "VN-2024-88421", "234,50 €",
            "1. März 2025", "m.gonzalez@web.de", "0151 88776655",
        ],
        "must_not_anonymize": [],
    },
    {
        "id": "DE-012",
        "language": "de",
        "category": "technical_metrics",
        "policy": "amount_debate",
        "input": (
            "Server-Report März 2025: Uptime 99,7%.\n"
            "RAM: 64 GB, CPU: 16 Kerne AMD EPYC.\n"
            "Kafka 3.6 Throughput: 145.000 Nachrichten/Sek.\n"
            "PostgreSQL 15 Queries: 2.3M täglich. Version 3.2.1"
        ),
        "must_anonymize": [],
        "must_not_anonymize": ["99,7%", "64 GB", "AMD EPYC", "Kafka 3.6", "PostgreSQL 15", "Version 3.2.1"],
    },
    {
        "id": "DE-013",
        "language": "de",
        "category": "support_chat",
        "input": (
            "Nutzer: Ich kann mich nicht einloggen.\n"
            "Support: Bitte nennen Sie mir Ihre E-Mail.\n"
            "Nutzer: es ist tobias.richter@gmail.com\n"
            "Support: Ihr temporäres Passwort ist: Xy#9mK2!\n"
            "Bitte ändern Sie es sofort."
        ),
        "must_anonymize": ["tobias.richter@gmail.com", "Xy#9mK2!"],
        "must_not_anonymize": [],
    },
    {
        "id": "DE-014",
        "language": "de",
        "category": "logistics",
        "input": (
            "Lieferung für: Erika Mustermann,\n"
            "Lieferadresse: Berliner Str. 99, 10317 Berlin.\n"
            "Paketnummer: DE123456789DE\n"
            "Zustellung geplant: Dienstag, 18. März 2025.\n"
            "Kontakt Fahrer: 0170 5544332"
        ),
        "must_anonymize": ["Erika Mustermann", "18. März 2025", "0170 5544332"],
        "must_not_anonymize": ["Berliner Str. 99", "10317 Berlin", "DE123456789DE"],
    },
    {
        "id": "DE-015",
        "language": "de",
        "category": "mixed_languages_de_base",
        "input": (
            "Hi Nadine, kannst du das Meeting mit John Baker\n"
            "(j.baker@microsoft.com) auf Freitag den 14. März\n"
            "verschieben? Er ist unter +1 425 882 8080 erreichbar.\n"
            "Angebot: $320,000. Bitte mit Christoph Maier abstimmen."
        ),
        "must_anonymize": [
            "Nadine", "John Baker", "j.baker@microsoft.com", "14. März",
            "+1 425 882 8080", "$320,000", "Christoph Maier",
        ],
        "must_not_anonymize": ["Meeting"],
    },
    {
        "id": "DE-016",
        "language": "de",
        "category": "code_sql",
        "input": (
            "SELECT * FROM users WHERE email LIKE '%@example.com'\n"
            "AND created_at > '2025-01-01';\n"
            "-- TODO: index on user_id\n"
            "-- Setup: siehe README.md"
        ),
        "must_anonymize": [],
        "must_not_anonymize": ["SELECT", "example.com", "user_id", "README.md"],
    },
    {
        "id": "DE-017",
        "language": "de",
        "category": "short_minimal",
        "input": "Danke!",
        "must_anonymize": [],
        "must_not_anonymize": ["Danke"],
    },
    {
        "id": "DE-018",
        "language": "de",
        "category": "conference_call",
        "input": (
            "Einwahldaten Vorstandssitzung 20. Februar 2025:\n"
            "Telefon: +49 800 123 4567\n"
            "Konferenz-PIN: 998877\n"
            "Moderator: Dr. Wolfgang Hartmann\n"
            "Backup: +49 89 999 8877"
        ),
        "must_anonymize": [
            "20. Februar 2025", "+49 800 123 4567", "998877",
            "Wolfgang Hartmann", "+49 89 999 8877",
        ],
        "must_not_anonymize": ["Vorstandssitzung"],
    },
    {
        "id": "DE-019",
        "language": "de",
        "category": "hr_salary_review",
        "input": (
            "Gehaltsanpassung für Mitarbeiter-ID MA-4421:\n"
            "Aktuell: 72.000 € → Neu: 78.500 € ab 1. April 2025.\n"
            "Genehmigt von: Lena Brandt (HR)\n"
            "Empfänger-IBAN: DE12 2004 1010 0208 3000 00"
        ),
        "must_anonymize": [
            "72.000 €", "78.500 €", "1. April 2025",
            "Lena Brandt", "DE12 2004 1010 0208 3000 00",
        ],
        "must_not_anonymize": ["MA-4421", "HR"],
    },
    {
        "id": "DE-020",
        "language": "de",
        "category": "press_release",
        "policy": "public_ok",
        "input": (
            "Siemens AG gibt heute bekannt, dass das Unternehmen\n"
            "im Geschäftsjahr 2024 einen Umsatz von 77,8 Milliarden\n"
            "Euro erzielt hat. CEO Roland Busch kommentierte:\n"
            "'Wir sind auf Kurs.'"
        ),
        "must_anonymize": ["Roland Busch"],
        "must_not_anonymize": ["Siemens AG", "77,8 Milliarden", "2024"],
    },
    {
        "id": "DE-021",
        "language": "de",
        "category": "dating_app_profile",
        "input": (
            "Hallo, ich bin Marco, 34 Jahre, aus München.\n"
            "Ich suche jemanden für gemeinsame Wandertouren.\n"
            "Schreib mir: marco_abenteuer@web.de"
        ),
        "must_anonymize": ["Marco", "marco_abenteuer@web.de"],
        "must_not_anonymize": ["München", "34 Jahre"],
    },
    {
        "id": "DE-022",
        "language": "de",
        "category": "system_log",
        "input": (
            "[2025-03-14 09:23:11] INFO: Service started.\n"
            "[2025-03-14 09:23:12] WARN: DB connection retry 3/5.\n"
            "[2025-03-14 09:23:15] ERROR: Timeout after 30s.\n"
            "Process ID: 84421. Exit code: 1."
        ),
        "must_anonymize": [],
        "must_not_anonymize": ["INFO", "WARN", "ERROR", "84421"],
    },
    {
        "id": "DE-023",
        "language": "de",
        "category": "invoice",
        "pair_id": "invoice",
        "input": (
            "Rechnung Nr. 2025-0156\n"
            "An: Peter Zimmermann GmbH, z.H. Stefan Zimmermann\n"
            "Betrag: 12.340,00 € zzgl. MwSt.\n"
            "Bankverbindung: IBAN DE44 2004 0060 0519 0150 00\n"
            "Fällig am: 15. April 2025\n"
            "Ihre Steuernummer: 21/815/08150"
        ),
        "must_anonymize": [
            "Stefan Zimmermann", "12.340,00 €", "DE44 2004 0060 0519 0150 00",
            "15. April 2025", "21/815/08150",
        ],
        "must_not_anonymize": ["Peter Zimmermann GmbH", "2025-0156"],
    },
    {
        "id": "DE-024",
        "language": "de",
        "category": "multi_person_email",
        "input": (
            "CC: anna@test.de, bob@test.de, carol@test.de\n"
            "Von: d.schmidt@firma.de\n"
            "Betreff: Budgetfreigabe\n\n"
            "Hallo Daniel, bitte leite das an Werner Schulze weiter.\n"
            "Budget Q2: 890.000 €. Kontakt: +49 30 9988776"
        ),
        "must_anonymize": [
            "anna@test.de", "bob@test.de", "carol@test.de", "d.schmidt@firma.de",
            "Daniel", "Werner Schulze", "890.000 €", "+49 30 9988776",
        ],
        "must_not_anonymize": ["Q2"],
    },
    {
        "id": "DE-025",
        "language": "de",
        "category": "only_technical_content",
        "input": (
            "Docker image: nginx:1.25-alpine\n"
            "Port mapping: 8080:80\n"
            "Environment: OLLAMA_HOST=localhost:11434\n"
            "Volume: /data/quon:/app/data\n"
            "Restart policy: unless-stopped"
        ),
        "must_anonymize": [],
        "must_not_anonymize": ["nginx:1.25-alpine", "8080:80", "OLLAMA_HOST", "/data/quon", "unless-stopped"],
    },
    # ----------------------------- ENGLISH (25) ----------------------------
    {
        "id": "EN-001",
        "language": "en",
        "category": "business_email",
        "input": (
            "Dear Mr. Johnson, please find attached the proposal\n"
            "for Project Delta. Our contact at Goldman Sachs is\n"
            "Sarah Williams (s.williams@gs.com, +1 212 555 0147).\n"
            "Contract value: $4.2M. Sign by March 31st, 2025.\n"
            "Best regards, Michael Chen"
        ),
        "must_anonymize": [
            "Johnson", "Sarah Williams", "s.williams@gs.com", "+1 212 555 0147",
            "$4.2M", "March 31st, 2025", "Michael Chen",
        ],
        "must_not_anonymize": ["Goldman Sachs", "Project Delta"],
    },
    {
        "id": "EN-002",
        "language": "en",
        "category": "hr_context",
        "input": (
            "Applicant: James O'Brien, DOB 09/15/1978,\n"
            "SSN: 123-45-6789, 742 Evergreen Terrace,\n"
            "Springfield IL 62701. Current salary $95,000.\n"
            "Email: j.obrien@gmail.com, Cell: +1 617 333 9921"
        ),
        "must_anonymize": [
            "James O'Brien", "09/15/1978", "123-45-6789", "$95,000",
            "j.obrien@gmail.com", "+1 617 333 9921",
        ],
        "must_not_anonymize": ["Springfield IL 62701", "Evergreen Terrace"],
    },
    {
        "id": "EN-003",
        "language": "en",
        "category": "financial_wire",
        "input": (
            "Please wire $320,000 to Robert J. Taylor by March 31st.\n"
            "IBAN: GB29 NWBK 6016 1331 9268 19\n"
            "Routing: 026009593, Barclays London.\n"
            "Reference: INV-2025-0891"
        ),
        "must_anonymize": [
            "Robert J. Taylor", "March 31st", "$320,000",
            "GB29 NWBK 6016 1331 9268 19", "026009593",
        ],
        "must_not_anonymize": ["Barclays London", "INV-2025-0891"],
    },
    {
        "id": "EN-004",
        "language": "en",
        "category": "medical_us",
        "pair_id": "medical_record",
        "input": (
            "Patient: Emily Rodriguez, DOB 03/22/1990,\n"
            "Insurance ID: BCB-9912345. Primary care:\n"
            "Dr. Kevin Walsh, kevin.walsh@clinic.org,\n"
            "(617) 555-2390. Next appointment: April 14, 2025."
        ),
        "must_anonymize": [
            "Emily Rodriguez", "03/22/1990", "BCB-9912345", "Kevin Walsh",
            "kevin.walsh@clinic.org", "(617) 555-2390", "April 14, 2025",
        ],
        "must_not_anonymize": [],
    },
    {
        "id": "EN-005",
        "language": "en",
        "category": "internal_tech",
        "policy": "amount_debate",
        "input": (
            "The new API at https://api.internal.gs.com/v2/users\n"
            "is live. Contact dev-team@firma.de for credentials.\n"
            "Runs on Kubernetes 1.28, PostgreSQL 15, Kafka 3.6.\n"
            "Uptime: 99.7%. Specs: 64GB RAM, 16 vCPU AMD EPYC."
        ),
        "must_anonymize": ["https://api.internal.gs.com/v2/users"],
        "must_not_anonymize": [
            "dev-team@firma.de", "Kubernetes", "PostgreSQL", "Kafka", "99.7%", "64GB RAM",
        ],
    },
    {
        "id": "EN-006",
        "language": "en",
        "category": "generic_slack_message",
        "input": (
            "Hey team, the sprint review is on Friday.\n"
            "Please update your tickets before then.\n"
            "The retrospective doc is in Confluence.\n"
            "See you all there!"
        ),
        "must_anonymize": [],
        "must_not_anonymize": ["sprint review", "Confluence", "tickets"],
    },
    {
        "id": "EN-007",
        "language": "en",
        "category": "legal_contract",
        "input": (
            "Agreement between Lisa Marie Thompson\n"
            "(SSN 987-65-4321, DOB January 3rd, 1985)\n"
            "of 15 Oak Street, Boston MA 02101\n"
            "and TechCorp Inc. Signed February 1st, 2025."
        ),
        "must_anonymize": [
            "Lisa Marie Thompson", "987-65-4321", "January 3rd, 1985", "February 1st, 2025",
        ],
        "must_not_anonymize": ["TechCorp Inc.", "Boston MA", "Oak Street"],
    },
    {
        "id": "EN-008",
        "language": "en",
        "category": "support_ticket",
        "input": (
            "Ticket #88421 – User cannot login.\n"
            "User email: charlie.brown@outlook.com\n"
            "Temp password issued: P@ssw0rd#42\n"
            "Reset link sent to +1 555 234 5678.\n"
            "Escalated to: tier2-support@company.com"
        ),
        "must_anonymize": ["charlie.brown@outlook.com", "P@ssw0rd#42", "+1 555 234 5678"],
        "must_not_anonymize": ["Ticket #88421", "tier2-support@company.com"],
    },
    {
        "id": "EN-009",
        "language": "en",
        "category": "conference_call",
        "input": (
            "Board meeting March 20th, 2025.\n"
            "Dial-in: +1 800 555 0199\n"
            "Conference PIN: 84721\n"
            "Host: Dr. Amanda Foster\n"
            "Backup line: +1 888 333 4455"
        ),
        "must_anonymize": [
            "March 20th, 2025", "+1 800 555 0199", "84721",
            "Amanda Foster", "+1 888 333 4455",
        ],
        "must_not_anonymize": ["Board meeting"],
    },
    {
        "id": "EN-010",
        "language": "en",
        "category": "sales_crm",
        "input": (
            "Lead: Patricia Wong, CTO at DataFlow Inc.\n"
            "Email: p.wong@dataflow.io, Mobile: +65 9123 4567.\n"
            "Deal size: $780,000. Close date: June 30, 2025.\n"
            "Notes: Met at AWS re:Invent. Strong interest."
        ),
        "must_anonymize": [
            "Patricia Wong", "p.wong@dataflow.io", "+65 9123 4567",
            "$780,000", "June 30, 2025",
        ],
        "must_not_anonymize": ["DataFlow Inc.", "AWS re:Invent", "CTO"],
    },
    {
        "id": "EN-011",
        "language": "en",
        "category": "false_positive_news",
        "policy": "public_ok",
        "input": (
            "Apple reported quarterly revenue of $119.6 billion.\n"
            "CEO Tim Cook stated the company expects continued\n"
            "growth in the services segment.\n"
            "Analysts at Morgan Stanley raised their price target."
        ),
        "must_anonymize": [],
        "must_not_anonymize": ["Apple", "Tim Cook", "Morgan Stanley", "$119.6 billion"],
    },
    {
        "id": "EN-012",
        "language": "en",
        "category": "mixed_de_en",
        "input": (
            "Hi Nadine, can you move the meeting with John Baker\n"
            "(j.baker@microsoft.com) to Friday March 14th?\n"
            "He's at +1 425 882 8080. Offer is $320,000.\n"
            "Please align with Christoph Maier. Danke!"
        ),
        "must_anonymize": [
            "Nadine", "John Baker", "j.baker@microsoft.com", "March 14th",
            "+1 425 882 8080", "$320,000", "Christoph Maier",
        ],
        "must_not_anonymize": ["meeting"],
    },
    {
        "id": "EN-013",
        "language": "en",
        "category": "system_log",
        "input": (
            "[2025-03-14 09:23:11] INFO Service started OK\n"
            "[2025-03-14 09:23:12] WARN DB retry 3/5\n"
            "[2025-03-14 09:23:15] ERROR Timeout 30s\n"
            "PID: 84421 ExitCode: 1 Host: prod-server-03"
        ),
        "must_anonymize": [],
        "must_not_anonymize": ["INFO", "WARN", "ERROR", "prod-server-03", "84421"],
    },
    {
        "id": "EN-014",
        "language": "en",
        "category": "recruiting_email",
        "input": (
            "Hi Marcus, following up on your application\n"
            "for the Staff Engineer role. Interview scheduled\n"
            "for Tuesday April 8th, 2025 at 2pm PST.\n"
            "Video link: meet.google.com/abc-defg-hij\n"
            "Interviewer: Rachel Kim (r.kim@company.com)"
        ),
        "must_anonymize": ["Marcus", "April 8th, 2025", "Rachel Kim", "r.kim@company.com"],
        "must_not_anonymize": ["Staff Engineer", "meet.google.com/abc-defg-hij"],
    },
    {
        "id": "EN-015",
        "language": "en",
        "category": "invoice_english",
        "pair_id": "invoice",
        "input": (
            "Invoice #INV-2025-0156\n"
            "Bill to: John Smith Consulting LLC, Attn: John Smith\n"
            "Amount due: $8,450.00\n"
            "Bank: Chase, Account: 000123456789, Routing: 021000021\n"
            "Due: April 15, 2025. Tax ID: 12-3456789"
        ),
        "must_anonymize": [
            "John Smith", "$8,450.00", "000123456789", "021000021",
            "April 15, 2025", "12-3456789",
        ],
        # "John Smith Consulting LLC" omitted: replace-all of "John Smith" would
        # always break it, so it is not a fair false-positive probe.
        "must_not_anonymize": ["Chase", "INV-2025-0156"],
    },
    {
        "id": "EN-016",
        "language": "en",
        "category": "technical_docs",
        "input": (
            "Docker compose setup:\n"
            "  image: quon-scrubber:0.1.0\n"
            "  ports: 8000:8000\n"
            "  env: OLLAMA_URL=http://localhost:11434\n"
            "  volumes: ./data:/app/data\n"
            "No personal data in this config."
        ),
        "must_anonymize": [],
        "must_not_anonymize": ["quon-scrubber:0.1.0", "8000:8000", "OLLAMA_URL", "./data"],
    },
    {
        "id": "EN-017",
        "language": "en",
        "category": "short_clean",
        "input": "Thanks!",
        "must_anonymize": [],
        "must_not_anonymize": ["Thanks"],
    },
    {
        "id": "EN-018",
        "language": "en",
        "category": "multi_person_cc",
        "input": (
            "From: jennifer.park@firma.de\n"
            "To: board@company.com\n"
            "CC: alice@co.com, bob.smith@co.com\n\n"
            "Hi all, please review before our call with\n"
            "Wei Zhang (w.zhang@partner.cn, +86 10 8888 9999).\n"
            "Budget approved: $2.1M for FY2025."
        ),
        "must_anonymize": [
            "jennifer.park@firma.de", "alice@co.com", "bob.smith@co.com",
            "Wei Zhang", "w.zhang@partner.cn", "+86 10 8888 9999", "$2.1M",
        ],
        "must_not_anonymize": ["board@company.com", "FY2025"],
    },
    {
        "id": "EN-019",
        "language": "en",
        "category": "healthcare_us",
        "pair_id": "insurance_health",
        "input": (
            "From: Dr. Sarah Mitchell <s.mitchell@hospital.org>\n"
            "Re: Patient follow-up\n\n"
            "Mr. Thompson's latest results (DOB 05/12/1962,\n"
            "MRN 7734521) show improvement.\n"
            "Please call him at (312) 555-7890 before Thursday."
        ),
        "must_anonymize": [
            "Sarah Mitchell", "s.mitchell@hospital.org", "Thompson",
            "05/12/1962", "7734521", "(312) 555-7890",
        ],
        "must_not_anonymize": ["MRN"],
    },
    {
        "id": "EN-020",
        "language": "en",
        "category": "public_content",
        "policy": "amount_debate",
        "input": (
            "The European Union's GDPR regulation requires\n"
            "companies to protect personal data.\n"
            "Article 5 outlines key principles including\n"
            "data minimization and purpose limitation.\n"
            "Fines can reach up to €20 million or 4% of turnover."
        ),
        "must_anonymize": [],
        "must_not_anonymize": ["European Union", "GDPR", "Article 5", "€20 million"],
    },
    {
        "id": "EN-021",
        "language": "en",
        "category": "dating_profile",
        "input": (
            "Hey, I'm Alex, 28, based in London.\n"
            "Love hiking and coffee.\n"
            "Drop me a line: alex_hikes@gmail.com"
        ),
        "must_anonymize": ["Alex", "alex_hikes@gmail.com"],
        "must_not_anonymize": ["London", "28"],
    },
    {
        "id": "EN-022",
        "language": "en",
        "category": "vendor_review",
        "input": (
            "Subject: Q2 Vendor Review – Action Items\n\n"
            "Hi team, following up on last Thursday's call.\n"
            "Sarah Williams (s.williams@gs.com, +1 212 555 0147)\n"
            "remains our contact at Goldman Sachs.\n"
            "James Patrick O'Brien: j.obrien@legalpartners.com,\n"
            "+1 617 333 9921. Deputy: Lisa Tran\n"
            "(l.tran@legalpartners.com).\n\n"
            "Budget: $4,200,000. First payment $320,000 by\n"
            "March 31st, 2025.\n"
            "Account: Robert J. Taylor\n"
            "IBAN: GB29 NWBK 6016 1331 9268 19\n"
            "Routing: 026009593, Barclays London.\n\n"
            "API: https://api.internal.gs.com/v2/users live Feb 28th.\n"
            "Contact dev-team@firma.de for access.\n"
            "Kubernetes 1.28, PostgreSQL 15, Kafka 3.6. 99.7% uptime.\n\n"
            "Michael Chen leads go-live June 5th 2025.\n"
            "Dial-in: +1 800 555 0199, PIN: 84721.\n\n"
            "Jennifer Park, j.park@firma.de, +49 89 9876543"
        ),
        "must_anonymize": [
            "Sarah Williams", "s.williams@gs.com", "+1 212 555 0147",
            "James Patrick O'Brien", "j.obrien@legalpartners.com", "+1 617 333 9921",
            "Lisa Tran", "l.tran@legalpartners.com", "$4,200,000", "$320,000",
            "March 31st, 2025", "Robert J. Taylor", "GB29 NWBK 6016 1331 9268 19",
            "026009593", "https://api.internal.gs.com/v2/users", "Michael Chen",
            "June 5th 2025", "+1 800 555 0199", "84721", "Jennifer Park",
            "j.park@firma.de", "+49 89 9876543",
        ],
        "must_not_anonymize": [
            "Goldman Sachs", "Barclays London", "dev-team@firma.de",
            "Kubernetes", "PostgreSQL", "Kafka", "99.7%",
        ],
    },
    {
        "id": "EN-023",
        "language": "en",
        "category": "chat_informal",
        "input": (
            "hey can u send me tom's number?\n"
            "think its tom.harris@gmail.com\n"
            "or maybe +44 7700 900123\n"
            "he owes me lunch lol"
        ),
        "must_anonymize": ["tom.harris@gmail.com", "+44 7700 900123"],
        "must_not_anonymize": [],
    },
    {
        "id": "EN-024",
        "language": "en",
        "category": "code_comment",
        "policy": "amount_debate",
        "input": (
            "# Author: see git log\n"
            "# TODO: replace hardcoded values\n"
            "# Example email: user@example.com (test only)\n"
            "# DO NOT use real user data in tests\n"
            "API_KEY = 'test-key-do-not-use-in-prod'"
        ),
        "must_anonymize": [],
        "must_not_anonymize": ["user@example.com", "API_KEY", "test-key-do-not-use-in-prod", "git log"],
    },
    {
        "id": "EN-025",
        "language": "en",
        "category": "long_german_business",
        "input": (
            "Betreff: Projektupdate Phoenix\n\n"
            "Hallo zusammen, Anna-Lena Schulz beginnt am 1. April.\n"
            "Kontakt: a.schulz@firma.de, 0176 9876543.\n"
            "Budget Q2/Q3: 1.250.000 €, davon 340.000 € extern.\n"
            "Überweisung 47.500 € an Max Mustermann,\n"
            "IBAN DE89 3704 0044 0532 0130 00.\n"
            "Extern: Dr. Michael Krause, m.krause@siemens.com,\n"
            "+49 170 1234567. Assistenz: Petra Hoffmann.\n"
            "Steuerkomitee: Freitag 14. März 2025, Berlin Raum 4B.\n"
            "Präsentation: Christoph Maier.\n"
            "System: Kubernetes, SCADA via Kafka, Version 3.2.1.\n"
            "MfG Thomas Berger, thomas.berger@firma.de,\n"
            "+49 30 12345678"
        ),
        "must_anonymize": [
            "Anna-Lena Schulz", "1. April", "a.schulz@firma.de", "0176 9876543",
            "1.250.000 €", "340.000 €", "47.500 €", "Max Mustermann",
            "DE89 3704 0044 0532 0130 00", "Michael Krause", "m.krause@siemens.com",
            "+49 170 1234567", "Petra Hoffmann", "14. März 2025", "Christoph Maier",
            "Thomas Berger", "thomas.berger@firma.de", "+49 30 12345678",
        ],
        "must_not_anonymize": [
            "Phoenix", "Q2", "Q3", "Kubernetes", "SCADA", "Kafka",
            "Version 3.2.1", "Berlin", "Raum 4B",
        ],
    },
    # ------------------------ REGRESSION + P2 EXPANSION (8) ------------------
    {
        "id": "DE-026",
        "language": "de",
        "category": "german_medical_letter",
        "input": (
            "Sehr geehrte Damen und Herren,\n\n"
            "ich habe von meinem behandelnden Arzt, Dr. med. Stefan Weber aus der "
            "Gemeinschaftspraxis Altona in Hamburg, ein Attest erhalten. Aufgrund meiner "
            "chronischen Erschöpfung und den vorliegenden Laborwerten (IgA-Mangel) empfiehlt "
            "er dringend eine Rehabilitation für 3 Wochen. Meine Versichertennummer ist "
            "KV-98234-A-7. Reiche ich das Attest direkt bei Ihnen ein oder muss ich das "
            "vorher bei der Rentenversicherung prüfen lassen?"
        ),
        "must_anonymize": [
            {"value": "Stefan Weber", "type": "PERSON"},
            {"value": "Dr. med. Stefan Weber", "type": "PERSON"},
            {"value": "KV-98234-A-7", "type": "INSURANCE_ID"},
        ],
        "must_not_anonymize": ["Reiche", "3 Wochen", "Hamburg", "Altona", "Rentenversicherung"],
        "pair_id": "german_medical_letter",
    },
    {
        "id": "EN-031",
        "language": "en",
        "category": "german_medical_letter",
        "pair_id": "german_medical_letter",
        "input": (
            "Dear Sir or Madam,\n\n"
            "I received a medical certificate from my treating physician, Dr. Stefan Weber "
            "at the Altona group practice in Hamburg. Due to chronic fatigue and lab results "
            "(IgA deficiency) he strongly recommends rehabilitation for 3 weeks. My insurance "
            "member ID is KV-98234-A-7. Should I submit the certificate directly to you or "
            "check with the pension insurance first?"
        ),
        "must_anonymize": [
            {"value": "Stefan Weber", "type": "PERSON"},
            {"value": "Dr. Stefan Weber", "type": "PERSON"},
            {"value": "KV-98234-A-7", "type": "INSURANCE_ID"},
        ],
        "must_not_anonymize": ["3 weeks", "Hamburg", "Altona", "pension insurance"],
    },
    {
        "id": "DE-027",
        "language": "de",
        "category": "german_verb_fp",
        "input": (
            "Schreibe mir bitte morgen eine Nachricht.\n"
            "Reiche ich das Formular heute noch ein?\n"
            "Sehr geehrte Damen und Herren, anbei die Unterlagen."
        ),
        "must_anonymize": [],
        "must_not_anonymize": ["Schreibe", "Reiche", "Sehr geehrte"],
    },
    {
        "id": "DE-028",
        "language": "de",
        "category": "german_insurance_kv",
        "input": (
            "Versichertennummer KV-44521-B-9 für Herrn Thomas Klein.\n"
            "Rückfragen unter thomas.klein@krankenkasse.de oder 030 4455667."
        ),
        "must_anonymize": [
            {"value": "KV-44521-B-9", "type": "INSURANCE_ID"},
            {"value": "Thomas Klein", "type": "PERSON"},
            {"value": "thomas.klein@krankenkasse.de", "type": "EMAIL"},
            {"value": "030 4455667", "type": "PHONE"},
        ],
        "must_not_anonymize": ["Versichertennummer"],
    },
    {
        "id": "DE-029",
        "language": "de",
        "category": "long_german_chat",
        "pair_id": "long_business",
        "input": (
            "Betreff: Rückmeldung zur Reha-Anmeldung und Unterlagen\n\n"
            "Sehr geehrte Damen und Herren,\n\n"
            "bezugnehmend auf unser Telefonat vom 12. März 2025 möchte ich die "
            "Unterlagen für meinen Antrag auf Rehabilitationsmaßnahmen nachreichen. "
            "Mein behandelnder Arzt Dr. med. Stefan Weber aus der Gemeinschaftspraxis "
            "Altona hat mir ein Attest ausgestellt, das ich anbei übersende. In dem "
            "Schreiben wird eine dreiwöchige Kur empfohlen; die genaue Dauer von 3 Wochen "
            "soll laut Kasse zunächst geprüft werden.\n\n"
            "Für Rückfragen erreichen Sie mich unter stefan.weber@example.de oder "
            "+49 170 1234567. Meine Versichertennummer lautet KV-98234-A-7. "
            "Reiche ich die ärztlichen Unterlagen direkt bei Ihnen ein, oder muss ich "
            "zuerst die Rentenversicherung informieren?\n\n"
            "Mit freundlichen Grüßen\nNadine Becker"
        ),
        "must_anonymize": [
            {"value": "12. März 2025", "type": "DATE"},
            {"value": "Stefan Weber", "type": "PERSON"},
            {"value": "Dr. med. Stefan Weber", "type": "PERSON"},
            {"value": "stefan.weber@example.de", "type": "EMAIL"},
            {"value": "+49 170 1234567", "type": "PHONE"},
            {"value": "KV-98234-A-7", "type": "INSURANCE_ID"},
            {"value": "Nadine Becker", "type": "PERSON"},
        ],
        "must_not_anonymize": ["Reiche", "3 Wochen", "Rentenversicherung", "Altona"],
    },
    {
        "id": "DE-030",
        "language": "de",
        "category": "security_secrets",
        "pair_id": "security_secrets",
        "input": (
            "Einwahldaten für das HR-Onboarding:\n"
            "Konferenz-PIN: 442819\n"
            "Temporäres Passwort: Secr3t!2025\n"
            "Interne Dokumentation: https://wiki.intern.firma.de/hr/onboarding\n"
            "Ansprechpartner: Sandra Meier, s.meier@firma.de"
        ),
        "must_anonymize": [
            {"value": "442819", "type": "PIN"},
            {"value": "Secr3t!2025", "type": "CREDENTIAL"},
            {"value": "https://wiki.intern.firma.de/hr/onboarding", "type": "URL"},
            {"value": "Sandra Meier", "type": "PERSON"},
            {"value": "s.meier@firma.de", "type": "EMAIL"},
        ],
        "must_not_anonymize": ["HR-Onboarding"],
    },
    {
        "id": "EN-029",
        "language": "en",
        "category": "long_english_chat",
        "pair_id": "long_business",
        "input": (
            "Subject: Follow-up on vendor review and wire instructions\n\n"
            "Hi team,\n\n"
            "Following last Thursday's call I am consolidating the action items for "
            "Project Delta. Sarah Williams (s.williams@gs.com, +1 212 555 0147) remains "
            "our primary contact at Goldman Sachs. James Patrick O'Brien from legal "
            "(j.obrien@legalpartners.com, +1 617 333 9921) confirmed the revised MSA.\n\n"
            "Please wire the first tranche of $320,000 to Robert J. Taylor by March 31st, "
            "2025 using IBAN GB29 NWBK 6016 1331 9268 19 (routing 026009593). The internal "
            "API is now live at https://api.internal.gs.com/v2/users — contact "
            "dev-team@firma.de for credentials.\n\n"
            "Board dial-in for June 5th 2025: +1 800 555 0199, PIN 84721. "
            "Backup contact Jennifer Park, j.park@firma.de, +49 89 9876543.\n\n"
            "Thanks,\nMichael Chen"
        ),
        "must_anonymize": [
            {"value": "Sarah Williams", "type": "PERSON"},
            {"value": "s.williams@gs.com", "type": "EMAIL"},
            {"value": "+1 212 555 0147", "type": "PHONE"},
            {"value": "James Patrick O'Brien", "type": "PERSON"},
            {"value": "j.obrien@legalpartners.com", "type": "EMAIL"},
            {"value": "+1 617 333 9921", "type": "PHONE"},
            {"value": "$320,000", "type": "AMOUNT"},
            {"value": "Robert J. Taylor", "type": "PERSON"},
            {"value": "March 31st, 2025", "type": "DATE"},
            {"value": "GB29 NWBK 6016 1331 9268 19", "type": "IBAN"},
            {"value": "026009593", "type": "ROUTING"},
            {"value": "https://api.internal.gs.com/v2/users", "type": "URL"},
            {"value": "June 5th 2025", "type": "DATE"},
            {"value": "+1 800 555 0199", "type": "PHONE"},
            {"value": "84721", "type": "PIN"},
            {"value": "Jennifer Park", "type": "PERSON"},
            {"value": "j.park@firma.de", "type": "EMAIL"},
            {"value": "+49 89 9876543", "type": "PHONE"},
            {"value": "Michael Chen", "type": "PERSON"},
        ],
        "must_not_anonymize": ["Goldman Sachs", "Project Delta", "dev-team@firma.de"],
    },
    {
        "id": "EN-030",
        "language": "en",
        "category": "security_secrets",
        "pair_id": "security_secrets",
        "input": (
            "Remote onboarding credentials:\n"
            "Conference dial-in PIN: 887766\n"
            "API key: sk-live-abc123xyz\n"
            "Internal endpoint: https://portal.internal.corp.com/v1/employees\n"
            "Contact: Rachel Kim, r.kim@company.com"
        ),
        "must_anonymize": [
            {"value": "887766", "type": "PIN"},
            {"value": "sk-live-abc123xyz", "type": "CREDENTIAL"},
            {"value": "https://portal.internal.corp.com/v1/employees", "type": "URL"},
            {"value": "Rachel Kim", "type": "PERSON"},
            {"value": "r.kim@company.com", "type": "EMAIL"},
        ],
        "must_not_anonymize": ["Remote onboarding"],
    },
]


# --- Integrity checks (cheap sanity guards used by the test runner) --------
from expectations import token_values  # noqa: E402

assert len(TEST_CASES) == 58, f"expected 58 cases, found {len(TEST_CASES)}"
assert len({c["id"] for c in TEST_CASES}) == 58, "duplicate test-case ids"
for _c in TEST_CASES:
    for _tok in _c["must_not_anonymize"]:
        _val = _tok["value"] if isinstance(_tok, dict) else _tok
        assert _val.lower() in _c["input"].lower(), f"{_c['id']}: must_not token {_val!r} absent from input"
    for _tok in token_values(_c["must_anonymize"]):
        assert _tok.lower() in _c["input"].lower(), f"{_c['id']}: must_anonymize token {_tok!r} absent from input"
