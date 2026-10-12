# JUWA — extraction et contrôle de factures

Un pipeline TypeScript traite un dossier de PDF avec **Mistral OCR**, puis un modèle Mistral qui extrait un JSON contraint par un schéma. Des contrôles déterministes vérifient les données et les montants. Une interface React présente les résultats, les sources OCR et les anomalies facture par facture.

**État de validation :** les 77 tests automatisés et la compilation passent. La démonstration permet de parcourir les quatre factures et les anomalies attendues. L’essai réel des quatre PDF est bloqué à l’OCR par des réponses Mistral `HTTP 429` ; les appels chat sont également refusés avec une limite effective de zéro requête par minute. La clé est reconnue, mais les écrans d’abonnement et d’accès API du compte donnent des indications contradictoires. Une extraction réelle réussie reste à vérifier avec un accès API fonctionnel. Les données de démonstration sont saisies manuellement et ne sont pas présentées comme une sortie Mistral.

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

Les extraits doivent apparaître dans la page OCR annoncée. La valeur doit aussi être retrouvée dans son extrait, avec une normalisation limitée du texte, des nombres, des dates et des devises. Cela écarte certaines inventions ; cela ne détecte pas une erreur OCR répétée dans l’extrait, ni une valeur correcte prise dans la mauvaise colonne.

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
| `examples/reference-inputs.json` | Référence manuelle, jamais utilisée par le pipeline réel. |
| `tests/` | Tests de schéma, provenance, calculs, erreurs API et isolation du lot. |
| `Vault JUWA/` | Documentation Obsidian : architecture, rôle des fichiers et déroulement du code. |

Ouvrir **`Vault JUWA` comme dossier de coffre Obsidian**, puis `00 Accueil.md`. Aucun plugin n’est requis. Les liens vers les PDF dans `Sources/` fonctionnent sur le coffre local initial ; dans un clone, ajouter les documents fournis séparément pour utiliser ces liens.

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

## Choix et limites

- **TypeScript de bout en bout** et schéma Zod partagé pour éviter deux contrats divergents entre CLI et navigateur.
- **React/Vite, résultats statiques** : une page sans serveur métier, authentification ou base de données. Le dépôt couvre le parcours minimal demandé ; le dépôt de PDF se fait dans le dossier d’entrée, pas dans un formulaire web.
- **HTTP natif et Mistral uniquement** : deux appels distincts par facture pour rendre OCR et structuration inspectables. Pas de modèle alternatif ni de substitution silencieuse par les fixtures.
- **decimal.js** évite les erreurs usuelles d’arithmétique binaire sur les montants. Les valeurs d’origine restent distinctes des calculs de contrôle.
- **Traitement séquentiel** adapté au petit lot. Sur erreurs réseau, `429` et `5xx`, deux nouvelles tentatives au maximum ; délai de 90 secondes par tentative et attente bornée entre tentatives.
- **Périmètre limité** : un document doit contenir une facture, au maximum 20 Mio de PDF et 100 000 caractères OCR. Les factures multi-taux, remises globales, frais annexes ou conventions d’arrondi particulières nécessitent une évolution du schéma/des contrôles. Deux décimales sont supposées pour les montants.
- **Fiabilité** : la validation de structure et les calculs ne garantissent pas zéro erreur du modèle. La relecture humaine reste nécessaire, notamment pour les scans, mauvais encodages et valeurs sans preuve suffisante. Le JSON importé n’est pas une attestation cryptographique de provenance.
- **Résultats sensibles** : `.env`, les PDF et les résultats locaux sont ignorés par Git. Un `build` effectué avec `public/results.json` inclut ce fichier dans `dist/` ; contrôler son contenu avant tout hébergement.

Pour 4 000 factures par mois : une file de tâches avec concurrence limitée et backoff, un stockage des PDF/résultats avec accès contrôlé, une reprise par empreinte et version de modèle/prompt, des métriques d’erreur/coût et une file de relecture remplaceraient le dossier local. Le coût dépendrait des pages OCR et des tokens des deux étapes ; il devrait être mesuré sur un échantillon représentatif avant dimensionnement.

## Références

- [Mistral — OCR](https://docs.mistral.ai/studio/document-processing/basic_ocr)
- [Mistral — sorties structurées](https://docs.mistral.ai/studio/conversations/structured-output/custom)
- [Zod — conversion JSON Schema](https://zod.dev/json-schema)
- [Vite — démarrage](https://vite.dev/guide/)
