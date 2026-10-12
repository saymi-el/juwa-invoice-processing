# Données de référence

`reference-inputs.json` contient une transcription manuelle des quatre factures du test.
Elle sert uniquement à la démonstration et à la vérification des résultats. Le pipeline
`src/pipeline` ne l'importe jamais et n'utilise aucune règle propre à ces fournisseurs.

`npm run demo` crée `public/demo.json` avec `mode: "demo"`. Le texte présenté comme
source dans cette démonstration est reconstitué manuellement ; ce n'est pas une sortie OCR.
La commande ne remplace pas `public/results.json`, réservé aux extractions réelles.

`npm run verify:results -- public/results.json` compare les résultats réels aux valeurs
connues et refuse un lot de démonstration. Une valeur à `null` demande une relecture ;
elle peut être préférable à une erreur silencieuse.
