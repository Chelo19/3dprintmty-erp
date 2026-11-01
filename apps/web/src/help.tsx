import { useEffect, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useRole } from "./roles";
import { Modal } from "./modal";
import { Notice } from "./notice";
import { helpTopic, pageHelpTopic, searchHelpTopics, visibleHelpTopics, type HelpTopic } from "./help-content";

function InfoIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 10.5v6M12 7v.5" /></svg>;
}

function TopicContent({ topic, onTopic }: { topic: HelpTopic; onTopic: (id: string) => void }) {
  const visible = visibleHelpTopics(useRole());
  const related = (topic.related ?? []).flatMap(id => { const found = visible.find(item => item.id === id); return found ? [found] : []; });
  return <div className="help-content">
    <p className="help-summary">{topic.summary}</p>
    <h3>Cómo hacerlo</h3>
    <ol>{topic.steps.map(step => <li key={step}>{step}</li>)}</ol>
    {topic.example ? <div className="help-example"><strong>Ejemplo</strong><p>{topic.example}</p></div> : null}
    {topic.notes?.length ? <section className="help-notes"><h3>Antes de continuar</h3><ul>{topic.notes.map(note => <li key={note}>{note}</li>)}</ul></section> : null}
    {related.length ? <nav className="help-related" aria-label="Temas relacionados"><span>También puede servirte</span>{related.map(item => <button type="button" className="ghost" key={item.id} onClick={() => onTopic(item.id)}>{item.title}</button>)}</nav> : null}
  </div>;
}

/** Native button: usable with keyboard/touch and never submits its surrounding form. */
export function HelpButton({ topic: id, label }: { topic: string; label?: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const role = useRole();
  const allowed = visibleHelpTopics(role);
  if (!allowed.some(topic => topic.id === id)) return null;
  const topic = helpTopic(id);
  const open = openId ? allowed.find(item => item.id === openId) : undefined;
  return <>
    <button type="button" className={`info-button${label ? " info-button--label" : ""}`} title={`Información: ${topic.title}`} aria-label={`Información: ${topic.title}`} aria-haspopup="dialog" onClick={() => setOpenId(id)}><InfoIcon />{label ? <span>{label}</span> : null}</button>
    {open ? <Modal title={open.title} onClose={() => setOpenId(null)}>
      <TopicContent topic={open} onTopic={setOpenId} />
      <Link className="help-guide-link" to={`/app/ayuda?tema=${encodeURIComponent(open.id)}`} onClick={() => setOpenId(null)}>Abrir este tema en la guía de uso</Link>
    </Modal> : null}
  </>;
}

export function PageHelp() {
  const { pathname } = useLocation();
  const topic = pageHelpTopic(pathname);
  return topic ? <div className="help-toolbar no-print"><HelpButton key={pathname} topic={topic.id} label="Ayuda de esta pantalla" /></div> : null;
}

export function UserGuidePage() {
  const role = useRole();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const visible = visibleHelpTopics(role);
  const chosenId = params.get("tema");
  const chosen = visible.find(topic => topic.id === chosenId) ?? visible.find(topic => topic.id === "inicio");
  const matches = searchHelpTopics(visible.filter(topic => !category || topic.category === category), search);
  const categories = [...new Set(visible.map(topic => topic.category))];
  const choose = (id: string) => {
    setParams({ tema: id });
    document.getElementById("guide-article")?.focus();
  };
  useEffect(() => { document.getElementById("guide-article")?.scrollTo({ top: 0 }); }, [chosen?.id]);
  return <section className="guide-page">
    <header className="guide-heading"><p className="guide-eyebrow">3dprintnow · Centro de ayuda</p><h1>Guía de uso</h1><p>Aprende el flujo del taller y consulta una tarea cuando la necesites. Los temas y accesos se ajustan a tu rol.</p></header>
    <div className="guide-layout">
      <aside className="guide-index" aria-label="Índice de la guía">
        <label>Buscar una tarea<input type="search" placeholder="Abonos, filamento, descuentos…" value={search} onChange={event => setSearch(event.target.value)} /></label>
        <label>Área<select value={category} onChange={event => setCategory(event.target.value)}><option value="">Todas las áreas</option>{categories.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
        <p className="costing-hint" aria-live="polite">{matches.length} {matches.length === 1 ? "tema disponible" : "temas disponibles"}</p>
        <nav aria-label="Temas de ayuda">{matches.map(topic => <button type="button" key={topic.id} className={`guide-topic${chosen?.id === topic.id ? " is-selected" : ""}`} aria-current={chosen?.id === topic.id ? "page" : undefined} onClick={() => choose(topic.id)}><span>{topic.category}</span><strong>{topic.title}</strong></button>)}</nav>
        {!matches.length ? <Notice title="No encontramos ese tema" action={<button type="button" className="ghost" onClick={() => { setSearch(""); setCategory(""); }}>Limpiar búsqueda</button>}>Prueba con el nombre de un módulo o una acción.</Notice> : null}
      </aside>
      {chosen ? <article className="guide-article" id="guide-article" tabIndex={-1} aria-labelledby="guide-topic-title">
        <p className="guide-eyebrow">{chosen.category}</p><h2 id="guide-topic-title">{chosen.title}</h2>
        {chosenId && !visible.some(topic => topic.id === chosenId) ? <Notice title="Tema no disponible">Este tema no existe o no corresponde a los permisos de tu rol. Puedes elegir otro en el índice.</Notice> : null}
        <TopicContent topic={chosen} onTopic={id => { setSearch(""); setCategory(""); choose(id); }} />
        {chosen.path ? <Link className="primary new-link help-module-link" to={chosen.path}>Ir al módulo</Link> : null}
      </article> : null}
    </div>
  </section>;
}
