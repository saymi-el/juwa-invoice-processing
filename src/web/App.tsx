import { useEffect, useRef, useState } from 'react';
import { batchSchema } from '../shared/schema';
import type { Batch, InvoiceResult } from '../shared/schema';
import { InvoiceDetail, StatusBadge } from './InvoiceDetail';
import { formatAmount, formatDate } from './format';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
type StatusFilter = 'all' | InvoiceResult['status'];

function parseBatch(text: string): Batch {
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error('Ce fichier ne contient pas un JSON valide. Sélectionnez le fichier results.json généré par le pipeline.'); }
  const parsed = batchSchema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Le format du résultat est invalide${issue?.path.length ? ` (champ : ${issue.path.join('.')})` : ''}. Utilisez un résultat compatible avec le schéma version 1.`);
  }
  const ids = parsed.data.invoices.map(invoice => invoice.id);
  if (new Set(ids).size !== ids.length) throw new Error('Le fichier contient des identifiants de factures en double. Générez à nouveau le lot.');
  return parsed.data;
}

export function App() {
  const [batch, setBatch] = useState<Batch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  const [origin, setOrigin] = useState('results.json');
  const fileInput = useRef<HTMLInputElement>(null);
  const request = useRef(0);

  function acceptBatch(nextBatch: Batch, nextOrigin: string) {
    setBatch(nextBatch); setOrigin(nextOrigin); setSelectedId(nextBatch.invoices[0]?.id ?? null);
    setFilter('all'); setQuery(''); setError(null);
  }

  async function loadResults(fileName = 'results.json', signal?: AbortSignal) {
    const currentRequest = ++request.current;
    setLoading(true); setError(null);
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}${fileName}`, { cache: 'no-store', signal });
      // Vite's SPA fallback can answer a missing JSON file with index.html and HTTP 200.
      if (response.status === 404 || response.headers.get('content-type')?.includes('text/html')) throw new Error(fileName === 'demo.json'
        ? 'Le lot de démonstration est absent. Lancez npm run demo puis réessayez.'
        : 'Aucun résultat disponible. Lancez npm run pipeline ou importez un fichier results.json. Vous pouvez aussi consulter la démonstration.');
      if (!response.ok) throw new Error(`Impossible de charger les résultats (HTTP ${response.status}). Réessayez ou importez votre fichier JSON.`);
      const text = await response.text();
      if (new Blob([text]).size > MAX_FILE_BYTES) throw new Error('Le fichier de résultats dépasse la limite de 10 Mo. Traitez un lot de factures plus petit.');
      const parsed = parseBatch(text);
      if (currentRequest === request.current) acceptBatch(parsed, fileName);
    } catch (cause) {
      if (currentRequest === request.current && !signal?.aborted) setError(cause instanceof Error ? cause.message : 'Impossible de charger les résultats.');
    } finally {
      if (currentRequest === request.current && !signal?.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void loadResults('results.json', controller.signal);
    return () => controller.abort();
  }, []);

  async function importFile(file: File | undefined) {
    if (!file) return;
    const currentRequest = ++request.current;
    setLoading(true); setError(null);
    try {
      if (!file.name.toLowerCase().endsWith('.json')) throw new Error('Sélectionnez un fichier .json produit par le pipeline.');
      if (file.size > MAX_FILE_BYTES) throw new Error('Ce fichier dépasse la limite de 10 Mo. Sélectionnez un lot plus petit.');
      const parsed = parseBatch(await file.text());
      if (currentRequest === request.current) acceptBatch(parsed, file.name);
    } catch (cause) {
      if (currentRequest === request.current) setError(cause instanceof Error ? cause.message : 'Impossible de lire ce fichier.');
    } finally {
      if (currentRequest === request.current) setLoading(false);
    }
  }

  const invoices = batch?.invoices ?? [];
  const search = query.trim().toLocaleLowerCase('fr');
  const filteredInvoices = invoices.filter(result => (filter === 'all' || result.status === filter)
    && [result.fileName, result.invoice?.supplier.value, result.invoice?.invoiceNumber.value]
      .some(value => value?.toLocaleLowerCase('fr').includes(search)));
  const selected = filteredInvoices.find(invoice => invoice.id === selectedId) ?? filteredInvoices[0];
  const counts = { all: invoices.length, ok: invoices.filter(i => i.status === 'ok').length, review: invoices.filter(i => i.status === 'review').length, error: invoices.filter(i => i.status === 'error').length };

  return <>
    <a className="skip-link" href="#main-content">Aller aux factures</a>
    <header className="app-header"><a className="brand" href={import.meta.env.BASE_URL} aria-label="GARNIER Industrie — accueil"><span className="brand-mark" aria-hidden="true">G<span>.</span></span><span>GARNIER<span className="brand-subtitle">INDUSTRIE</span></span></a>
      <div className="header-divider" /><span className="header-section">Espace fournisseurs</span><span className="header-tag">COMPTABILITÉ</span></header>
    <main id="main-content" className="app-main">
      <div className="page-heading"><div><p className="eyebrow">Documents · Achats</p><h1>Factures fournisseurs<span className="title-dot">.</span></h1><p className="page-subtitle">Consultez les données extraites et les points à vérifier.</p></div>
        <div className="actions"><button className="button button-demo" disabled={loading} onClick={() => void loadResults('demo.json')}>Voir la démonstration</button><button className="button button-secondary" disabled={loading} onClick={() => void loadResults()}><span aria-hidden="true">↻</span> Actualiser</button>
          <button className="button button-primary" disabled={loading} onClick={() => fileInput.current?.click()}><span aria-hidden="true">↑</span> Importer un JSON</button>
          <input className="sr-only" ref={fileInput} type="file" accept=".json,application/json" aria-label="Importer un fichier de résultats JSON, 10 Mo maximum" onChange={event => { void importFile(event.target.files?.[0]); event.target.value = ''; }} tabIndex={-1} /></div>
      </div>

      {batch?.mode === 'demo' && <aside className="demo-notice"><span className="demo-tag">DÉMONSTRATION</span><p>Résultats de référence saisis manuellement. Aucune extraction Mistral n’a été effectuée pour ce lot.</p></aside>}
      {error && <div className="load-error" role="alert"><div><strong>Le chargement n’a pas abouti</strong><p>{error}</p>{batch && <p>Le dernier lot chargé reste affiché.</p>}</div><button className="button button-secondary" disabled={loading} onClick={() => void loadResults()}>Réessayer</button></div>}

      {loading && <div className="loading-state" role="status"><span className="spinner" aria-hidden="true" />Chargement des résultats…</div>}
      {batch && <>
        <div className="batch-overview"><div className="batch-stats"><span><strong>{counts.all}</strong> facture{counts.all > 1 ? 's' : ''}</span><span className="stat-review"><strong>{counts.review}</strong> à vérifier</span><span><strong>{counts.error}</strong> en échec</span></div><p>Lot du {formatDate(batch.generatedAt.slice(0, 10))} <span className="separator">/</span> {origin}</p></div>
        {invoices.length === 0 ? <section className="empty-state"><span className="empty-icon" aria-hidden="true">≡</span><h2>Ce lot ne contient aucune facture</h2><p>Traitez un dossier contenant des PDF, puis rechargez ses résultats.</p></section> : <div className="workspace" aria-busy={loading}>
          <aside className="invoice-sidebar" aria-label="Liste des factures"><div className="sidebar-controls"><div className="section-heading"><h2>Documents</h2><span className="count-label">{counts.all}</span></div>
            <label className="search-field"><span aria-hidden="true">⌕</span><span className="sr-only">Rechercher une facture, un fournisseur ou un numéro</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Rechercher une facture…" /></label>
            <label className="filter-field"><span>Afficher</span><select value={filter} onChange={event => setFilter(event.target.value as StatusFilter)} aria-label="Filtrer les factures par statut"><option value="all">Tous les statuts ({counts.all})</option><option value="review">À vérifier ({counts.review})</option><option value="ok">Contrôles passés ({counts.ok})</option><option value="error">Échecs ({counts.error})</option></select></label>
          </div>
            <ul className="invoice-list">{filteredInvoices.map((invoice, index) => <li key={invoice.id}><button className={`invoice-option ${selected?.id === invoice.id ? 'selected' : ''}`} aria-pressed={selected?.id === invoice.id} onClick={() => setSelectedId(invoice.id)}>
              <div className="invoice-option-top"><span className="document-number">{String(index + 1).padStart(2, '0')}</span><StatusBadge status={invoice.status} /></div>
              <strong>{invoice.invoice?.supplier.value ?? invoice.fileName}</strong><span className="invoice-number">{invoice.invoice?.invoiceNumber.value ?? 'Numéro non renseigné'}</span>
              <div className="invoice-option-bottom"><span>{invoice.invoice?.date.value ? formatDate(invoice.invoice.date.value) : 'Date non renseignée'}</span><span className="list-amount">{invoice.invoice?.totalTtc.value != null ? formatAmount(invoice.invoice.totalTtc.value, invoice.invoice.currency.value) : 'TTC non renseigné'}</span></div>
            </button></li>)}</ul>
            {filteredInvoices.length === 0 && <div className="no-results"><p>Aucune facture ne correspond à votre recherche.</p><button className="text-button" onClick={() => { setQuery(''); setFilter('all'); }}>Effacer les filtres</button></div>}
            <p className="sidebar-footnote">{filteredInvoices.length} document{filteredInvoices.length > 1 ? 's' : ''} affiché{filteredInvoices.length > 1 ? 's' : ''}</p>
          </aside>
          {selected ? <InvoiceDetail result={selected} demo={batch.mode === 'demo'} /> : <section className="empty-selection"><h2>Aucun document sélectionné</h2><p>Modifiez vos filtres pour afficher une facture.</p></section>}
        </div>}
      </>}
      {!batch && !loading && <section className="empty-state"><span className="empty-icon" aria-hidden="true">≡</span><h2>Vos résultats, au même endroit</h2><p>Importez le fichier JSON produit par le pipeline pour consulter les factures et leurs contrôles.</p><div className="empty-actions"><button className="button button-primary" onClick={() => fileInput.current?.click()}>Choisir un fichier JSON</button><button className="button button-secondary" onClick={() => void loadResults('demo.json')}>Voir la démonstration</button></div><p className="small muted">Fichier .json · 10 Mo maximum · lecture locale</p></section>}
      <footer className="page-footer"><span>GARNIER Industrie <span className="separator">/</span> Revue des factures</span><span>{batch?.mode === 'mistral' ? 'Extraction Mistral · ' : ''}Données à vérifier avant traitement comptable</span></footer>
    </main>
  </>;
}
