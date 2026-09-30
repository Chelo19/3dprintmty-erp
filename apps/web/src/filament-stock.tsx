import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "./api";
import { FormActions, IconAction, SaveButton, TrashIcon, useError } from "./operations";
import { FormSkeleton } from "./skeleton";

interface FilamentStock {
  id: string;
  sku: string;
  name: string;
  status: string;
  onHand: string;
}

interface Balance {
  productId: string;
  locationId: string;
  onHand: string;
}

interface Location {
  id: string;
  name: string;
  isDefault?: boolean;
}

const REASONS = ["Impresión", "Impresión fallida", "Prueba o calibración", "Rollo terminado"];
const OTHER = "Otro";

export function FilamentAdjustPage() {
  const { id = "" } = useParams();
  const [search, setSearch] = useSearchParams();
  const mode = search.get("modo") === "conteo" ? "count" : "subtract";
  const client = useQueryClient();
  const navigate = useNavigate();
  const { error, pendingKey, run } = useError();
  const inventory = useQuery({ queryKey: ["inventory-catalog"], queryFn: () => api<{ filaments: FilamentStock[] }>("/inventory") });
  const balances = useQuery({ queryKey: ["inventory-balances"], queryFn: () => api<{ data: Balance[] }>("/inventory/balances") });
  const locations = useQuery({ queryKey: ["locations"], queryFn: () => api<Location[]>("/locations") });
  const [locationId, setLocationId] = useState("");
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState<"g" | "kg">("g");
  const [reason, setReason] = useState(REASONS[0]!);
  const [otherReason, setOtherReason] = useState("");
  const [sealed, setSealed] = useState("0");
  const [perRoll, setPerRoll] = useState("1000");
  const [open, setOpen] = useState<string[]>([""]);
  const [note, setNote] = useState("");

  if (inventory.isPending || balances.isPending || locations.isPending) {
    return <section style={{ display: "grid", gap: 16 }}><FormSkeleton fields={5} /></section>;
  }
  const filament = inventory.data?.filaments.find((row) => row.id === id);
  if (!filament) {
    return (
      <section style={{ display: "grid", gap: 16 }}>
        <p><Link to="/app/inventario/filamentos">Inventario de filamentos</Link></p>
        <p className="error">No encontramos ese filamento.</p>
      </section>
    );
  }
  const places = locations.data ?? [];
  const location = places.find((row) => row.id === locationId) ?? places.find((row) => row.isDefault) ?? places[0];
  const current = Number((balances.data?.data ?? []).find((row) => row.productId === id && row.locationId === location?.id)?.onHand ?? 0);
  const subtractGrams = toNumber(amount) * (unit === "kg" ? 1000 : 1);
  const openGrams = open.reduce((sum, value) => sum + toNumber(value), 0);
  const counted = Math.trunc(toNumber(sealed)) * toNumber(perRoll) + openGrams;
  const after = mode === "count" ? counted : current - subtractGrams;
  const delta = after - current;
  const tooMuch = mode === "subtract" && subtractGrams > current;
  const finalReason = reason === OTHER ? otherReason.trim() : reason;

  const setMode = (value: string) => {
    const next = new URLSearchParams(search);
    if (value === "count") next.set("modo", "conteo");
    else next.delete("modo");
    setSearch(next, { replace: true });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (tooMuch) return;
    void run(async () => {
      const grams = mode === "count" ? counted : subtractGrams;
      await api(`/inventory/filaments/${filament.id}/adjust`, {
        method: "POST",
        body: JSON.stringify({
          mode,
          grams: formatGrams(grams),
          locationId: location?.id,
          reason: mode === "count" ? note.trim() || undefined : finalReason || undefined,
        }),
      });
      await client.invalidateQueries({ queryKey: ["inventory-catalog"] });
      await client.invalidateQueries({ queryKey: ["inventory-balances"] });
      await client.invalidateQueries({ queryKey: ["inventory-ledger"] });
      const notice = mode === "count"
        ? delta === 0
          ? `El conteo de ${filament.name} coincide con el sistema: ${formatKg(counted)}.`
          : `${filament.name} quedó en ${formatKg(counted)} (${delta > 0 ? "+" : "−"}${formatGrams(Math.abs(delta))} g).`
        : `Se restaron ${formatGrams(subtractGrams)} g de ${filament.name}. Quedan ${formatKg(after)}.`;
      navigate("/app/inventario/filamentos", { state: { notice } });
    }, "save");
  };

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <p><Link to="/app/inventario/filamentos">Inventario de filamentos</Link></p>
      <h1>{mode === "count" ? "Conteo físico" : "Restar consumo"} · {filament.name}</h1>
      <p>
        {mode === "count"
          ? "Cuenta los rollos cerrados y pesa los abiertos. El sistema calcula el total y registra solo la diferencia."
          : "Resta lo que se usó en impresiones, pruebas o merma. Imprimir no descuenta filamento por sí solo."}
      </p>
      <div className="costing-kpis">
        <div><span>En sistema</span><strong>{formatKg(current)}</strong></div>
        <div><span>{mode === "count" ? "Contado" : "Después de restar"}</span><strong className={after < 0 ? "profit-negative" : undefined}>{formatKg(after)}</strong></div>
        <div>
          <span>Diferencia</span>
          <strong className={delta > 0 ? "profit-positive" : delta < 0 ? "profit-negative" : undefined}>
            {delta > 0 ? "+" : delta < 0 ? "−" : ""}{formatGrams(Math.abs(delta))} g
          </strong>
        </div>
      </div>
      <form className="card form-vertical" onSubmit={submit}>
        <label>
          Tipo de ajuste
          <select value={mode} onChange={(event) => setMode(event.target.value)}>
            <option value="subtract">Restar consumo</option>
            <option value="count">Conteo físico</option>
          </select>
        </label>
        {places.length > 1 ? (
          <label>
            Sucursal
            <select value={location?.id ?? ""} onChange={(event) => setLocationId(event.target.value)}>
              {places.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </label>
        ) : null}
        {mode === "subtract" ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
              <label>
                Cantidad a restar
                <input required inputMode="decimal" placeholder={unit === "kg" ? "0.25" : "250"} value={amount} autoFocus onChange={(event) => setAmount(event.target.value)} />
              </label>
              <label>
                Unidad
                <select value={unit} onChange={(event) => setUnit(event.target.value as "g" | "kg")}>
                  <option value="g">g</option>
                  <option value="kg">kg</option>
                </select>
              </label>
            </div>
            {tooMuch ? <p className="error" style={{ margin: 0 }}>Solo hay {formatGrams(current)} g en {location?.name}. Si hay más, haz un conteo físico.</p> : null}
            <label>
              Motivo
              <select value={reason} onChange={(event) => setReason(event.target.value)}>
                {[...REASONS, OTHER].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            {reason === OTHER ? (
              <label>Describe el motivo<input required minLength={3} maxLength={180} value={otherReason} onChange={(event) => setOtherReason(event.target.value)} /></label>
            ) : null}
          </>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <label>
                Rollos cerrados
                <input type="number" min={0} step={1} required value={sealed} onChange={(event) => setSealed(event.target.value)} />
              </label>
              <label>
                Peso neto por rollo (g)
                <input inputMode="decimal" required value={perRoll} onChange={(event) => setPerRoll(event.target.value)} />
              </label>
            </div>
            <fieldset className="open-rolls">
              <legend>Rollos abiertos</legend>
              <p className="costing-hint" style={{ margin: 0 }}>Pesa cada rollo y réstale el carrete vacío. Deja en blanco si no hay abiertos.</p>
              {open.map((value, index) => (
                <div key={index} className="open-roll">
                  <label>
                    Rollo abierto {index + 1} (g)
                    <input
                      inputMode="decimal"
                      placeholder="0"
                      value={value}
                      onChange={(event) => setOpen((rows) => rows.map((row, at) => (at === index ? event.target.value : row)))}
                    />
                  </label>
                  {open.length > 1 ? (
                    <IconAction label={`Quitar rollo abierto ${index + 1}`} tone="delete" onClick={() => setOpen((rows) => rows.filter((_, at) => at !== index))}>
                      <TrashIcon />
                    </IconAction>
                  ) : null}
                </div>
              ))}
              <button className="ghost" type="button" style={{ justifySelf: "start" }} onClick={() => setOpen((rows) => [...rows, ""])}>Agregar rollo abierto</button>
            </fieldset>
            <label>Nota<input maxLength={160} placeholder="Opcional" value={note} onChange={(event) => setNote(event.target.value)} /></label>
          </>
        )}
        <FormActions>
          <SaveButton
            label={mode === "count" ? "Guardar conteo" : "Restar del inventario"}
            pending={pendingKey === "save"}
          />
          {error ? <p className="error">{error}</p> : null}
        </FormActions>
      </form>
    </section>
  );
}

export function formatKg(grams: number): string {
  return `${(grams / 1000).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 3 })} kg`;
}

export function rollsHint(grams: number): string {
  if (grams <= 0) return "";
  const rolls = grams / 1000;
  return `≈ ${rolls.toLocaleString("es-MX", { maximumFractionDigits: 1 })} ${rolls === 1 ? "rollo" : "rollos"} de 1 kg`;
}

function toNumber(value: string): number {
  const parsed = Number(value.trim().replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function formatGrams(value: number): string {
  return String(Math.round(value * 10000) / 10000);
}
