import type { InvoiceResult, Warning } from '../shared/schema';
import { evidenceLabel, fieldLabel, formatAmount, formatDate, formatNumber, statusLabels } from './format';
import type { SourcedField } from './format';

export function StatusBadge({ status }: { status: InvoiceResult['status'] }) {
  return <span className={`badge badge-${status}`}><span aria-hidden="true" className="status-dot" />{statusLabels[status]}</span>;
}

function Field({ label, field, fieldName, warnings, format = String }: {
  label: string; field: SourcedField; fieldName: string; warnings: Warning[];
  format?: (value: string | number) => string;
}) {
  const messages = warnings.filter(warning => warning.field === fieldName);
  return <div className={`data-field ${field.value === null || messages.length ? 'field-attention' : ''}`}>
    <dt>{label}</dt>
    <dd>{field.value === null ? <span className="missing">Non renseigné</span> : format(field.value)}</dd>
    {messages.length > 0 && <p className="field-warning">{messages.map(message => message.message).join(' ')}</p>}
    <details className="evidence">
      <summary>Source{field.page ? ` · p. ${field.page}` : ''}<span className="sr-only"> du champ {label}</span></summary>
      <p>{field.evidence ?? 'Aucun extrait source disponible.'}</p>
    </details>
  </div>;
}

function Value({ field, currency, money = false, warnings, fieldName }: {
  field: SourcedField; currency: string | null; money?: boolean; warnings: Warning[]; fieldName: string;
}) {
  const flagged = warnings.some(warning => warning.field === fieldName);
  const title = evidenceLabel(field) + (flagged ? ' · ' + warnings.filter(w => w.field === fieldName).map(w => w.message).join(' ') : '');
  const value = field.value;
  return <span title={title} className={flagged ? 'flagged-value' : undefined}>
    {value === null ? <span className="missing">Non renseigné</span>
      : typeof value === 'number' ? (money ? formatAmount(value, currency) : formatNumber(value)) : value}
    {flagged && <span className="field-flag" aria-label="Champ à vérifier">!</span>}
  </span>;
}

export function InvoiceDetail({ result, demo }: { result: InvoiceResult; demo: boolean }) {
  const { invoice, warnings, checks } = result;
  const currency = invoice?.currency.value ?? null;
  const knownCurrency = currency !== null && /^[A-Z]{3}$/.test(currency);
  return <article className="invoice-detail" aria-labelledby="invoice-title">
    <div className="detail-heading">
      <div><p className="eyebrow">Facture fournisseur</p><h2 id="invoice-title">{invoice?.supplier.value ?? result.fileName}</h2>
        <p className="file-name"><span aria-hidden="true">↳</span> {result.fileName}</p></div>
      <StatusBadge status={result.status} />
    </div>

    {result.error && <section className="error-notice" role="alert">
      <h3>Cette facture n’a pas pu être traitée</h3>
      <p>{result.error.message}</p><p className="small">Étape : {({ file: 'lecture du fichier', ocr: 'reconnaissance du document', llm: 'extraction des données', schema: 'validation du résultat', unknown: 'non identifiée' })[result.error.stage]} · Code : {result.error.code}</p>
      <p className="small">Les autres factures restent consultables.</p>
    </section>}

    {invoice && <>
      <dl className="metadata-grid">
        <Field label="Numéro de facture" field={invoice.invoiceNumber} fieldName="invoiceNumber" warnings={warnings} />
        <Field label="Date de facture" field={invoice.date} fieldName="date" warnings={warnings} format={value => formatDate(String(value))} />
        <Field label="Fournisseur" field={invoice.supplier} fieldName="supplier" warnings={warnings} />
        <Field label="Devise" field={invoice.currency} fieldName="currency" warnings={warnings} />
      </dl>

      {warnings.length > 0 && <section className="warnings-panel" aria-labelledby="warnings-title">
        <div className="section-heading"><h3 id="warnings-title">Points à vérifier</h3><span className="count-label">{warnings.length}</span></div>
        <ul>{warnings.map((warning, index) => <li key={`${warning.code}-${warning.field}-${index}`}>
          <span className="warning-icon" aria-hidden="true">!</span><div><p>{warning.message}</p>
            <span className="warning-location">{fieldLabel(warning.field)}{warning.page ? ` · page ${warning.page}` : ''}</span></div>
        </li>)}</ul>
      </section>}

      <section className="line-items" aria-labelledby="items-title">
        <div className="section-heading"><h3 id="items-title">Lignes de facture</h3><span className="muted small">{invoice.items.length} ligne{invoice.items.length > 1 ? 's' : ''}</span></div>
        {!knownCurrency && <p className="currency-note">Devise non renseignée ou non reconnue : les montants sont affichés sans conversion.</p>}
        <div className="table-scroll" role="region" tabIndex={0} aria-label="Détail des lignes de facture, défilement horizontal si nécessaire">
          <table><caption className="sr-only">Désignations, quantités et montants tels qu’extraits du document</caption>
            <thead><tr><th scope="col">Désignation</th><th scope="col" className="numeric">Qté</th><th scope="col" className="numeric">Prix unitaire HT</th><th scope="col" className="numeric">Montant HT</th></tr></thead>
            <tbody>{invoice.items.map((item, index) => <tr key={index}>
              <td><Value field={item.description} currency={currency} warnings={warnings} fieldName={`items.${index}.description`} />
                <details className="evidence row-evidence"><summary>Sources de la ligne {index + 1}</summary>
                  <dl>{([['Désignation', item.description], ['Quantité', item.quantity], ['Prix unitaire', item.unitPrice], ['Montant', item.lineTotal]] as const).map(([label, field]) => <div key={label}><dt>{label}</dt><dd>{evidenceLabel(field)}</dd></div>)}</dl>
                </details></td>
              <td className="numeric"><Value field={item.quantity} currency={currency} warnings={warnings} fieldName={`items.${index}.quantity`} /></td>
              <td className="numeric"><Value field={item.unitPrice} currency={currency} money warnings={warnings} fieldName={`items.${index}.unitPrice`} /></td>
              <td className="numeric"><Value field={item.lineTotal} currency={currency} money warnings={warnings} fieldName={`items.${index}.lineTotal`} /></td>
            </tr>)}</tbody>
          </table>
          {invoice.items.length === 0 && <p className="empty-lines">Aucune ligne extraite. Consulter le document source.</p>}
        </div>
        <div className="totals-wrap"><p className="totals-note">Montants du document.<br />Les écarts sont signalés sans modifier les valeurs.</p>
          <dl className="totals">
            <Field label="Total HT" field={invoice.totalHt} fieldName="totalHt" warnings={warnings} format={value => formatAmount(Number(value), currency)} />
            <Field label="Taux de TVA" field={invoice.vatRate} fieldName="vatRate" warnings={warnings} format={value => `${formatNumber(Number(value))} %`} />
            <Field label="Montant TVA" field={invoice.vatAmount} fieldName="vatAmount" warnings={warnings} format={value => formatAmount(Number(value), currency)} />
            <div className="grand-total"><Field label="Total TTC" field={invoice.totalTtc} fieldName="totalTtc" warnings={warnings} format={value => formatAmount(Number(value), currency)} /></div>
          </dl>
        </div>
      </section>
    </>}

    <section className="checks-panel" aria-labelledby="checks-title"><div className="section-heading"><h3 id="checks-title">Contrôles de cohérence</h3><span className="muted small">{checks.filter(check => check.status === 'pass').length} / {checks.length} passés</span></div>
      <p className="section-description">Ces contrôles vérifient les données disponibles. Ils ne garantissent pas l’exactitude de l’extraction.</p>
      {checks.length === 0 ? <p className="muted small">Aucun contrôle disponible pour cette facture.</p> : <ul className="checks-list">{checks.map((check, index) => <li key={`${check.code}-${check.field}-${index}`}>
        <span className={`check-icon check-${check.status}`} aria-hidden="true">{check.status === 'pass' ? '✓' : check.status === 'fail' ? '!' : '−'}</span>
        <div className="check-copy"><strong>{check.label}</strong><p>{check.message}</p>
          {(check.actual !== null || check.expected !== null) && <p className="check-values">{check.expected !== null && <span>Attendu : {formatNumber(check.expected)}</span>}{check.actual !== null && <span>Lu : {formatNumber(check.actual)}</span>}{check.difference !== null && <span>Écart : {formatNumber(check.difference)}</span>}</p>}
        </div><span className={`check-label check-label-${check.status}`}>{({ pass: 'Passé', fail: 'Écart détecté', skipped: 'Non vérifiable' })[check.status]}</span>
      </li>)}</ul>}
    </section>

    <details className="ocr-panel"><summary>{demo ? 'Texte de référence et provenance' : 'Texte OCR et provenance'}<span>{result.pages.length} page{result.pages.length > 1 ? 's' : ''}</span></summary>
      <div className="ocr-content"><p className="small muted">Fichier : {result.fileName}</p>{demo && <p className="small">Les extraits de démonstration ont été saisis manuellement.</p>}
        {result.sha256 && <p className="hash small">Empreinte SHA-256 : <code>{result.sha256}</code></p>}
        {result.pages.length === 0 ? <p className="small muted">Aucun texte source disponible.</p> : result.pages.map(page => <section key={page.page}><h4>Page {page.page}</h4><pre>{page.markdown}</pre></section>)}
      </div></details>
  </article>;
}
