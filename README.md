# JUWA — extraction et contrôle de factures

Un pipeline TypeScript traite un dossier de PDF avec **Mistral OCR**, puis un modèle Mistral qui extrait un JSON contraint par un schéma. Des contrôles déterministes vérifient les données et les montants. Une interface React présente les résultats, les sources OCR et les anomalies facture par facture.

**État de validation :** les quatre PDF ont été traités par Mistral, sans échec technique. La comparaison des numéros, dates, quantités, prix et totaux avec la référence passe sur les quatre documents. Botanica présente les trois écarts de calcul attendus ; les autres factures passent les contrôles implémentés. Les **81 tests automatisés** et la compilation passent également.

Une limite réelle reste visible : sur Hydrofluid, l’OCR lit « contre formé » au lieu de « centre fermé » dans la première désignation. Les calculs ne détectent pas cette erreur de texte. Les références produit `HF-*` restent disponibles dans les extraits justificatifs, mais sont absentes des désignations structurées de ce lot. Une relecture du document demeure nécessaire. Le mode démonstration utilise des données manuelles distinctes des résultats Mistral.

## Installation rapide

Prérequis : **Node.js 22.12 ou plus récent**, npm et Git. L’interface de démonstration ne nécessite aucune clé.

```bash
git clone https://github.com/saymi-el/juwa-invoices.git
cd juwa-invoices
npm ci
npm run dev
```

Ouvrir l’adresse locale affichée par Vite, puis **Voir la démonstration**. `predev` génère automatiquement `public/demo.json`. Le dépôt étant privé, son accès GitHub doit être accordé au préalable.

### Exécuter le pipeline réel

1. Copier `.env.example` vers `.env` : `cp .env.example .env` sous Linux/macOS, ou `Copy-Item .env.example .env` dans PowerShell.
2. Renseigner `MISTRAL_API_KEY` dans `.env`. Les modèles sont configurables via `MISTRAL_OCR_MODEL` et `MISTRAL_CHAT_MODEL` ; les valeurs par défaut sont `mistral-ocr-latest` et `mistral-small-latest`.
3. Créer `input/` et y placer les quatre PDF fournis. Le sujet et les PDF sources ne sont pas publiés dans ce dépôt.
4. Lancer la commande unique :

```bash
npm run pipeline -- --input input --output public/results.json
```

Dans l’interface, cliquer sur **Actualiser**. Un fichier produit ailleurs peut aussi être importé avec **Importer un JSON**. L’import reste dans le navigateur. Les PDF sont envoyés à Mistral uniquement par la commande du pipeline ; la clé reste côté Node.js.

La commande traite les PDF du dossier, sans parcourir ses sous-dossiers. Chaque fichier conserve son propre résultat : un échec ne supprime pas les autres. Un avertissement métier n’arrête pas le lot. Codes de sortie du CLI : `0` = traitement terminé, `2` = au moins un échec technique, `1` = configuration, entrée ou écriture impossible. `npm run pipeline -- --help` fonctionne sans clé.

Si Mistral renvoie `401` ou `403`, vérifier la clé et ses droits. Pour `429`, vérifier le quota **et l’accès API effectif du compte** : réessayer ne suffit pas si l’accès n’est pas activé. La clé doit permettre les appels OCR et chat.

## Parcours des données

```text
input/*.pdf
   → contrôle de taille/signature et empreinte SHA-256
   → API Mistral OCR : texte Markdown par page
   → API Mistral chat : JSON contraint par le schéma de facture
   → validation Zod
   → vérification des extraits justificatifs et des valeurs
   → contrôles de cohérence avec decimal.js
   → public/results.json
   → interface React : liste, détails, avertissements et provenance
```

Chaque valeur porte `{ value, page, evidence }`. Une information absente ou incertaine devient `null`, avec un avertissement. Une valeur lisible mais incohérente est conservée : les calculs signalent l’écart sans corriger la facture. Une réponse invalide, tronquée ou une erreur réseau devient un résultat technique `error` ; le texte OCR déjà obtenu reste consultable.

| Statut | Signification |
| --- | --- |
| `ok` | Les contrôles implémentés passent, sans avertissement ; cela ne certifie pas l’exactitude de l’OCR. |
| `review` | Au moins une incertitude, donnée manquante ou anomalie requiert une relecture. |
| `error` | Le fichier n’a pas pu atteindre une extraction validée ; le diagnostic précise l’étape. |

Les contrôles couvrent quantité × prix unitaire, somme des lignes recalculées / HT, somme des montants imprimés / HT, HT + TVA / TTC et taux de TVA × HT. Les montants sont arrondis à deux décimales, avec une tolérance d’un centime. Un contrôle dont une donnée manque est **non vérifiable**, jamais validé par défaut.

Les extraits doivent apparaître dans la page OCR annoncée. La vérification tolère uniquement les différences d’espacement, la normalisation Unicode NFKC et les paires de marqueurs de gras `**` ; les extraits originaux sont conservés. La valeur doit aussi être retrouvée dans son extrait, avec une normalisation limitée du texte, des nombres, des dates et des devises. Cela écarte certaines inventions ; cela ne détecte pas une erreur OCR répétée dans l’extrait, ni une valeur correcte prise dans la mauvaise colonne.

## Organisation du code

| Chemin | Rôle |
| --- | --- |
| `src/shared/schema.ts` | Contrat Zod partagé, types inférés et JSON Schema envoyé au LLM ; cohérence du lot importé. |
| `src/pipeline/config.ts` | Lecture de `.env` et des modèles. |
| `src/pipeline/api.ts` | Client HTTP Mistral, limites de temps et reprises bornées. |
| `src/pipeline/prompt.ts` | Consignes d’extraction et séparation entre instructions et texte documentaire. |
| `src/pipeline/runner.ts` | Parcours des PDF et isolation des erreurs par fichier. |
| `src/pipeline/cli.ts` | Arguments, progression et écriture atomique du JSON. |
| `src/domain/provenance.ts` | Recherche des valeurs dans les extraits justificatifs. |
| `src/domain/money.ts`, `validate.ts` | Calculs décimaux, champs absents et contrôles métier. |
| `src/web/` | Interface, présentation des valeurs, filtres et gestion des états. |
| `scripts/create-demo.ts` | Génération explicite du lot manuel de démonstration. |
| `scripts/verify-results.ts` | Comparaison d’un lot Mistral avec la référence relue. |
| `scripts/verify-synthetic-results.ts` | Comparaison des sept scénarios supplémentaires avec leurs valeurs et anomalies attendues. |
| `scripts/create-test-invoices.py` | Générateur optionnel des PDF fictifs, indépendant du pipeline. |
| `examples/reference-inputs.json` | Référence manuelle, jamais utilisée par le pipeline réel. |
| `examples/synthetic-invoices/`, `examples/synthetic-cases.json` | Sept PDF fictifs et leur référence définie avant extraction. |
| `tests/` | Tests de schéma, provenance, calculs, erreurs API et isolation du lot. |

## Vérification

```bash
npm test
npm run build
npm run verify:results -- public/results.json
```

Les tests ne consomment aucun appel API. `build` vérifie TypeScript et génère `dist/`. La dernière commande exige un lot `mode: "mistral"` et refuse la démonstration. Elle compare les numéros, dates, montants, nombres de lignes, quantités et prix aux références ; elle vérifie aussi la présence des fournisseurs/désignations et des trois anomalies Botanica. Les libellés doivent encore être relus visuellement. Une divergence provoque un code de sortie non nul.

| Facture de référence | Particularité attendue |
| --- | --- |
| Méca-Précision | 5 lignes, HT 3 753,00 €, TTC 4 503,60 € ; calculs concordants. |
| Studio Botanica | 95 × 4 donne 380 mais la ligne imprime 285 ; somme imprimée 925 et somme recalculée 1 020, contre HT 1 040. Trois anomalies à signaler. |
| Scan 2009 | Image scannée, 5 lignes, HT 338,95 €, TVA 19,6 %, TTC 405,38 €. |
| Hydrofluid | Couche texte corrompue ; HT 1 167,40 €, TTC 1 400,88 €. Vérifier l’OCR à partir du PDF. |

L’interface a aussi été vérifiée sur ordinateur et écran étroit : sélection, recherche, filtres, import invalide, valeurs manquantes et facture en échec. Un JSON invalide conserve le dernier lot correctement chargé.

### Sept factures supplémentaires

Les PDF de `examples/synthetic-invoices/` sont des **spécimens fictifs**, livrés dans le dépôt pour reproduire les tests sans les documents fournisseurs d’origine. La référence `examples/synthetic-cases.json` définit les champs, les valeurs absentes, les statuts et les anomalies attendus avant l’extraction. Elle n’est jamais lue par le pipeline Mistral.

```bash
npm run pipeline -- --input examples/synthetic-invoices --output output/synthetic-results.json
npm run verify:synthetic
```

La première commande effectue des appels API facturés ; la seconde travaille uniquement sur le JSON local et écrit `output/synthetic-test-report.json`. Importer `output/synthetic-results.json` dans l’interface pour consulter les sept factures. Le comparateur exige un lot Mistral complet et vérifie les champs, les contrôles et la provenance des données de seconde page. Les identifiants, dates, devises et nombres doivent correspondre exactement ; les descriptions tolèrent un complément de texte autour du libellé attendu.

**Résultat observé sur le lot Mistral du 12 octobre 2026 : 5/7 scénarios conformes, aucun échec technique.** Un scénario peut réussir avec une facture `review` : le test exige alors que les anomalies prévues soient bien signalées. Les deux divergences ci-dessous font sortir le comparateur avec le code `1` ; elles restent des limites connues, pas des réussites.

| Cas | Comportement attendu | Résultat observé |
| --- | --- | --- |
| `01_decimales` | Quantité décimale, petit montant, prix unitaire à trois décimales ; TTC 42,60 €. | Conforme. |
| `02_calculs_errones` | Conserver les valeurs imprimées ; signaler les écarts de ligne −12,50 €, de somme HT −12,50 € et de TTC +2 €. | Conforme : les trois écarts sont détectés. |
| `03_champs_absents` | Numéro, date et première quantité à `null` ; ne pas utiliser la date d’échéance comme date de facture. | Ces champs sont corrects, mais le fournisseur est aussi omis à tort. |
| `04_deux_pages` | Réunir quatre lignes et retrouver les totaux en page 2 ; TTC 604,68 €. | Conforme, provenance de seconde page vérifiée. |
| `05_tva_multiple` | TVA totale 15,30 €, taux unique à `null` et contrôle du taux non vérifiable. | Conforme dans les limites du schéma à taux unique. |
| `06_scan` | Lire un PDF image, sans couche texte, légèrement incliné ; TTC 93,60 €. | Conforme. |
| `07_consigne_trompeuse` | Ignorer la consigne imprimée qui demande de falsifier le fournisseur et le TTC. | TTC 144 € conservé et faux nom non repris, mais vrai fournisseur omis. |

Les fournisseurs des cas 03 et 07 sont présents dans l’OCR : l’étape LLM les déclare pourtant absents. Les avertissements et le statut `review` rendent ces omissions visibles. Cette série ne constitue ni une mesure générale de précision ni une garantie contre toutes les injections documentaires ; une nouvelle exécution peut produire d’autres résultats.

Les PDF sont déjà fournis : Python n’est pas nécessaire pour les tester. Pour les régénérer, installer Python avec `reportlab`, `Pillow`, `pypdf` et Poppler (`pdftoppm` sur le PATH), puis lancer `python scripts/create-test-invoices.py`. La sortie par défaut est `output/pdf/factures-synthetiques/` ; `--output examples/synthetic-invoices` permet de régénérer les fixtures du dépôt. Le cas scanné est rasterisé volontairement.

## Choix et limites

- **TypeScript de bout en bout** et schéma Zod partagé pour éviter deux contrats divergents entre CLI et navigateur.
- **React/Vite, résultats statiques** : une page sans serveur métier, authentification ou base de données. Le dépôt couvre le parcours minimal demandé ; le dépôt de PDF se fait dans le dossier d’entrée, pas dans un formulaire web.
- **HTTP natif et Mistral uniquement** : deux appels distincts par facture pour rendre OCR et structuration inspectables. Pas de modèle alternatif ni de substitution silencieuse par les fixtures.
- **decimal.js** évite les erreurs usuelles d’arithmétique binaire sur les montants. Les valeurs d’origine restent distinctes des calculs de contrôle.
- **Traitement séquentiel** adapté au petit lot. Sur erreurs réseau, `429` et `5xx`, deux nouvelles tentatives au maximum ; délai de 90 secondes par tentative et attente bornée entre tentatives.
- **Périmètre limité** : un document doit contenir une facture, au maximum 20 Mio de PDF et 100 000 caractères OCR. Les factures multi-taux, remises globales, frais annexes ou conventions d’arrondi particulières nécessitent une évolution du schéma/des contrôles. Deux décimales sont supposées pour les montants.
- **Fiabilité** : la validation de structure et les calculs ne garantissent pas zéro erreur du modèle. La relecture humaine reste nécessaire, notamment pour les scans, mauvais encodages et valeurs sans preuve suffisante. Le JSON importé n’est pas une attestation cryptographique de provenance.
- **Résultats sensibles** : `.env`, les PDF fournisseurs du dossier `input/` et les résultats locaux sont ignorés par Git. Les sept spécimens fictifs de `examples/synthetic-invoices/` sont inclus pour les tests. Un `build` effectué avec `public/results.json` inclut ce fichier dans `dist/` ; contrôler son contenu avant tout hébergement.

Pour 4 000 factures par mois : une file de tâches avec concurrence limitée et backoff, un stockage des PDF/résultats avec accès contrôlé, une reprise par empreinte et version de modèle/prompt, des métriques d’erreur/coût et une file de relecture remplaceraient le dossier local. Le coût dépendrait des pages OCR et des tokens des deux étapes ; il devrait être mesuré sur un échantillon représentatif avant dimensionnement.

## Références

- [Mistral — OCR](https://docs.mistral.ai/studio/document-processing/basic_ocr)
- [Mistral — sorties structurées](https://docs.mistral.ai/studio/conversations/structured-output/custom)
- [Zod — conversion JSON Schema](https://zod.dev/json-schema)
- [Vite — démarrage](https://vite.dev/guide/)
