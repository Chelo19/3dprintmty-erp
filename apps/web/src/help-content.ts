import { canAccessPath, type TenantRole } from "@3dprintmty/domain";

export interface HelpTopic {
  id: string;
  title: string;
  category: "Primeros pasos" | "Ventas y cobranza" | "Catálogos" | "Inventario y compras" | "Fabricación" | "Administración";
  summary: string;
  path?: string;
  steps: string[];
  notes?: string[];
  example?: string;
  related?: string[];
}

export const HELP_TOPICS: HelpTopic[] = [
  { id: "inicio", title: "Tu primer recorrido por 3dprintnow", category: "Primeros pasos",
    summary: "Conoce el orden de trabajo y la diferencia entre vender, comprar y fabricar.",
    steps: ["Revisa los datos del taller, sus impuestos y métodos de pago con la persona administradora.", "Registra los artículos que utilizas: productos fabricados, productos de reventa, insumos, filamentos y servicios.", "Da entrada a los artículos comprados desde Compras. Para los productos fabricados, configura primero su receta.", "Registra al cliente. Usa Cotizaciones y Pedidos para trabajos por encargo, o Punto de venta para ventas de mostrador.", "Consulta inventario, producción y cobranza para dar seguimiento a entregas y saldos."],
    notes: ["Solo aparecen los módulos permitidos para tu rol. Un botón ausente o inhabilitado puede depender del rol, del estado del registro o de un requisito pendiente.", "Usa la búsqueda de esta guía o los botones de información de cada pantalla para consultar una tarea sin modificar datos."], related: ["catalogos", "pedidos", "punto-venta"] },
  { id: "dashboard", title: "Leer el inicio del taller", category: "Primeros pasos", path: "/app",
    summary: "Consulta el estado general antes de comenzar la jornada.",
    steps: ["Revisa pedidos pendientes, producción abierta y artículos con inventario bajo.", "Consulta los saldos y movimientos financieros si tu rol permite verlos.", "Abre el módulo correspondiente para atender cada pendiente; el resumen no sustituye su detalle."],
    notes: ["Las cifras monetarias y los módulos visibles dependen de tu rol. Los gastos cancelados no se suman a gastos ni cuentas por pagar."], related: ["cobranza", "produccion", "inventario"] },
  { id: "catalogos", title: "Elegir el catálogo correcto", category: "Catálogos", path: "/app/productos/fabricados",
    summary: "Separa lo que fabricas, lo que revendes y lo que consumes.",
    steps: ["Productos fabricados: artículos terminados que produces mediante una receta.", "Productos: artículos comprados para revender. Registra sus entradas en Compras.", "Insumos: componentes y materiales que consumes en las recetas.", "Filamentos: materiales de impresión; su compra se captura en kg y las existencias se manejan en gramos.", "Servicios: trabajos o conceptos sin existencias físicas, como diseño o acabado."],
    notes: ["Crear un artículo de catálogo no registra una compra ni da entrada a inventario.", "Los productos con fabricación habilitada no pueden comprarse desde Compras. Los costos del catálogo son valores por defecto; una compra con otro importe no los sobrescribe."], related: ["costos-catalogo", "recetas", "compras"] },
  { id: "fabricados", title: "Registrar productos fabricados", category: "Catálogos", path: "/app/productos/fabricados",
    summary: "Prepara un artículo terminado para producirlo y venderlo.",
    steps: ["Abre Catálogo → Productos fabricados y crea el artículo con un SKU y nombre reconocibles.", "Revisa su clasificación y precio de venta.", "Configura sus filamentos, insumos y servicios en Recetas.", "Crea una orden de producción para fabricar unidades y darles entrada al inventario."],
    notes: ["El costo del producto con receta se calcula a partir de ella. Dar de alta el producto no fabrica unidades automáticamente."], related: ["recetas", "produccion", "costos-catalogo"] },
  { id: "reventa", title: "Registrar productos de reventa", category: "Catálogos", path: "/app/productos/reventa",
    summary: "Administra artículos que compras y vendes sin fabricarlos.",
    steps: ["Abre Catálogo → Productos y registra el artículo como comprable.", "Define su costo por defecto y precio de venta cuando tu rol lo permita.", "Registra una compra con su cantidad e importe real para llenar el inventario.", "Véndelo desde un pedido o el punto de venta."],
    notes: ["El importe de una compra puede ser diferente del costo de catálogo y queda conservado en esa compra."], related: ["compras", "punto-venta", "inventario"] },
  { id: "insumos", title: "Administrar insumos", category: "Catálogos", path: "/app/insumos",
    summary: "Registra componentes que se compran y se consumen al fabricar.",
    steps: ["Registra el insumo con su SKU, nombre y unidad correspondiente.", "Configura el costo por defecto desde el catálogo, si tienes permiso.", "Da entrada mediante una compra y agrégalo a las recetas que lo utilizan.", "Revisa sus existencias y movimientos desde Inventario → Insumos."],
    notes: ["Los insumos se obtienen comprándolos; no se crean como órdenes de fabricación."], related: ["recetas", "compras", "inventario"] },
  { id: "filamentos", title: "Administrar filamentos", category: "Catálogos", path: "/app/filamentos",
    summary: "Distingue el costo por kilogramo de las cantidades en gramos.",
    steps: ["Registra material, color, diámetro y un SKU que distinga el filamento.", "Captura el costo del catálogo por kg cuando tu rol permita editarlo.", "En Compras, registra los kg recibidos; el sistema los convierte a gramos de inventario.", "En las recetas, indica los gramos necesarios por pieza. Usa el ajuste de inventario para registrar consumo o corregir el conteo."],
    example: "Un kg equivale a 1,000 g. Si el costo de catálogo es $200 por kg, 100 g representan $20 de material, antes de merma.",
    notes: ["El flujo actual permite fabricar aunque no haya existencias de filamento. Revisa y ajusta su consumo físico; la fabricación no lo descuenta automáticamente."], related: ["ajuste-filamento", "recetas", "compras"] },
  { id: "servicios", title: "Registrar servicios", category: "Catálogos", path: "/app/servicios",
    summary: "Usa conceptos como diseño, acabado o mano de obra sin crear existencias.",
    steps: ["Crea el servicio con nombre, código y unidad: minuto, hora, pieza o servicio.", "Captura el costo y precio de venta según tus permisos.", "Agrégalo a una cotización para venderlo o a una receta para incluirlo en su costo de fabricación."],
    notes: ["Un servicio no genera entradas ni salidas de inventario. Comprar un servicio como gasto es distinto de registrar el servicio que vendes."], related: ["recetas", "cotizaciones"] },
  { id: "costos-catalogo", title: "Entender costos y precios", category: "Catálogos", path: "/app/productos/fabricados",
    summary: "Diferencia el costo por defecto, el costo real de compra y el precio de venta.",
    steps: ["Costo de catálogo: referencia por defecto del artículo. Se utiliza para capturar compras y calcular recetas.", "Costo de compra: importe real pagado o por pagar en esa compra. Puedes modificarlo sin cambiar el catálogo.", "Costo de producto fabricado: resultado de los materiales, servicios y demás conceptos configurados en su receta.", "Precio de venta: importe comercial que cobras al cliente; revisa descuentos e impuestos en cada operación."],
    notes: ["Cambiar costos de filamentos, insumos o servicios en el catálogo actualiza los productos dependientes de esas recetas. Las compras y sus cancelaciones no sobrescriben esos costos.", "El operador puede consultar los catálogos sin ver costos ni márgenes."], related: ["compras", "recetas", "calculadora"] },
  { id: "clientes", title: "Dar de alta y buscar clientes", category: "Ventas y cobranza", path: "/app/clientes",
    summary: "Prepara el cliente para cotizar, vender y dar seguimiento al crédito.",
    steps: ["Abre Clientes → Nuevo cliente y captura sus datos de identificación y contacto.", "Si corresponde público en general, usa la casilla que completa su RFC genérico.", "Captura los datos fiscales y de domicilio que tengas; calle, colonia y código postal no son obligatorios en el alta.", "Busca y selecciona al cliente escribiendo su nombre en los campos con autocompletado de ventas."],
    notes: ["Se permiten varios clientes con RFC de público en general XAXX010101000. Esa excepción no elimina la validación de los demás RFC.", "Revisa las condiciones y el límite de crédito antes de trabajar con pagos diferidos."], related: ["cotizaciones", "pedidos", "credito"] },
  { id: "cotizaciones", title: "Crear y dar seguimiento a una cotización", category: "Ventas y cobranza", path: "/app/cotizaciones",
    summary: "Prepara una propuesta antes de convertirla en pedido.",
    steps: ["Abre Cotizaciones → Nueva cotización y selecciona al cliente con el autocompletado.", "Agrega artículos de catálogo o piezas temporales. Para impresiones, revisa cantidades, gramos y servicios por pieza.", "Verifica precios, descuentos e impuestos de cada partida.", "Define los días de validez, condiciones de pago y plazo de entrega que correspondan.", "Guarda y revisa el detalle. Utiliza las acciones disponibles para compartir el PDF, enviar, aceptar o convertir en pedido, según su estado."],
    notes: ["Una cotización no reserva ni descuenta inventario. El pedido es el que continúa el flujo de suministro y entrega.", "El operador puede crear cotizaciones, pero no editarlas después."], related: ["partidas-temporales", "impuestos-descuentos", "pedidos"] },
  { id: "partidas-temporales", title: "Cotizar piezas temporales", category: "Ventas y cobranza", path: "/app/cotizaciones",
    summary: "Cotiza un concepto sin darlo de alta en ningún catálogo.",
    steps: ["En la cotización, pulsa Agregar pieza temporal.", "Escribe una descripción clara, cantidad e importe unitario.", "Revisa su descuento e impuestos y guarda la cotización."],
    example: "PIEZA TEMPORAL 1 · 3 piezas · $332.42 por pieza = $997.26 antes de descuentos e impuestos.",
    notes: ["La partida no crea un producto, una receta ni existencias. Para manejar fabricación con receta o inventario, registra el artículo correspondiente en el catálogo."], related: ["cotizaciones", "fabricados"] },
  { id: "impuestos-descuentos", title: "Aplicar descuentos, IVA y retención ISR", category: "Ventas y cobranza", path: "/app/cotizaciones",
    summary: "Revisa los importes por partida antes de guardar o enviar una propuesta.",
    steps: ["Captura el descuento en MXN sobre el total de la partida, no como porcentaje.", "Revisa el IVA y la retención ISR de cada partida. Puedes tener partidas con porcentajes diferentes en la misma cotización.", "Usa IVA 0 % cuando el concepto no lleve IVA. El ISR retenido se resta del total por cobrar.", "Comprueba el total final después de descuentos, IVA y retenciones."],
    notes: ["Los campos de IVA e ISR se muestran según los valores por defecto configurados en el taller. Si están desactivados o en cero, no se muestran en la captura.", "En impresiones de varias piezas, los gramos y servicios se capturan por pieza; el descuento corresponde al total de la partida."], related: ["cotizaciones", "configuracion"] },
  { id: "pedidos", title: "Trabajar un pedido", category: "Ventas y cobranza", path: "/app/pedidos",
    summary: "Da seguimiento desde el encargo hasta su entrega y cobro.",
    steps: ["Crea el pedido con su cliente y partidas, o conviértelo desde una cotización aceptada.", "Revisa las condiciones, cantidades y fecha compromiso antes de confirmar.", "Confirma el pedido y atiende los requisitos que indique el sistema, como el límite de crédito.", "Usa Apartar inventario para unidades disponibles o Ir a producción para artículos fabricables pendientes.", "Da seguimiento a las acciones de entrega o prestación de cada partida y registra los cobros correspondientes."],
    notes: ["Las acciones dependen del estado del pedido y de cada partida. Lee el motivo que aparece si un paso está bloqueado.", "Marcar un servicio como Prestado registra su realización; no equivale a cobrarlo. Los artículos físicos requieren el movimiento de inventario correspondiente y no pueden entregarse sin unidades disponibles."], related: ["apartar-inventario", "produccion", "cobranza", "credito"] },
  { id: "apartar-inventario", title: "Apartar inventario o mandar a producción", category: "Ventas y cobranza", path: "/app/pedidos",
    summary: "Elige cómo cubrir las unidades físicas del pedido.",
    steps: ["Consulta la cantidad requerida y las existencias disponibles en el pedido.", "Aparta las unidades existentes para reservarlas a este pedido.", "Si faltan productos fabricables con receta, genera sus órdenes con Ir a producción.", "Si falta un producto comprado, registra su compra o entrada antes de intentar entregarlo."],
    notes: ["Apartar reserva unidades; no es una entrega ni un cobro. Las unidades apartadas reducen la disponibilidad para otros pedidos.", "Una partida de impresión o un servicio no sigue el mismo flujo que un producto terminado con receta."], related: ["pedidos", "produccion", "inventario"] },
  { id: "credito", title: "Revisar el límite de crédito", category: "Ventas y cobranza", path: "/app/pedidos",
    summary: "Comprueba la exposición del cliente antes de autorizar nuevos pedidos a crédito.",
    steps: ["Revisa el límite y las condiciones configuradas para el cliente.", "Registra los abonos que ya recibió el taller para que sus saldos estén actualizados.", "Si el pedido supera el límite, una persona con permiso debe revisar y autorizar la excepción con un motivo, cuando corresponda."],
    notes: ["Una autorización de crédito no liquida el saldo. El motivo se conserva en el pedido.", "Que un usuario pueda crear un pedido no significa que pueda autorizar excepciones de crédito."], related: ["clientes", "cobranza"] },
  { id: "cobranza", title: "Registrar cobros y abonos de clientes", category: "Ventas y cobranza", path: "/app/cobranza",
    summary: "Registra cuándo y cómo pagó el cliente y consulta el saldo restante.",
    steps: ["Abre Cobranza y selecciona el pedido o usa su acción de registrar abono.", "Captura el importe recibido y el método de pago.", "Selecciona la fecha real en que se recibió el dinero; puede ser distinta de la fecha de captura.", "Guarda y revisa el estado del movimiento y el saldo del pedido.", "Los movimientos contra entrega pueden quedar pendientes; confírmalos cuando realmente se reciba el pago."],
    notes: ["Un abono parcial reduce el saldo sin liquidarlo. Un cobro pendiente no es dinero recibido.", "No registres nuevamente un pago solo porque aún no ves actualizado el saldo: comprueba antes el detalle y el estado del movimiento."], related: ["pedidos", "punto-venta"] },
  { id: "punto-venta", title: "Hacer una venta de mostrador", category: "Ventas y cobranza", path: "/app/punto-de-venta",
    summary: "Cobra y entrega una venta inmediata desde una sola pantalla.",
    steps: ["Busca artículos y usa los filtros de servicio, producto terminado o producto.", "Agrega las partidas a la venta y ajusta sus cantidades.", "Revisa el total, el método de pago y, si corresponde, el efectivo recibido y el cambio.", "Confirma la venta. Consulta o reimprime el ticket desde el historial."],
    notes: ["Por defecto se ocultan los productos sin existencias. Mostrar los no disponibles no permite vender unidades que no existen.", "La venta de mostrador registra el cobro completo y la salida de los artículos físicos. Para un encargo con fabricación o pagos posteriores, usa Cotizaciones y Pedidos."], related: ["inventario", "pedidos", "cobranza"] },
  { id: "inventario", title: "Consultar existencias y movimientos", category: "Inventario y compras", path: "/app/inventario/filamentos",
    summary: "Distingue existencias físicas, unidades apartadas y disponibilidad.",
    steps: ["Elige la sección: productos fabricados, productos, insumos o filamentos.", "Busca el artículo y revisa sus existencias, apartados y disponibilidad.", "Abre su historial para consultar entradas, salidas, fechas y referencias.", "Registra compras para artículos adquiridos y producción para terminados fabricados. Usa ajustes solo para corregir el inventario físico o registrar movimientos justificados."],
    notes: ["El catálogo describe el artículo; el inventario refleja sus cantidades y movimientos.", "Registra un motivo claro en los ajustes. Una corrección de existencias no sustituye el registro de un gasto o un cobro."], related: ["compras", "produccion", "ajuste-filamento"] },
  { id: "ajuste-filamento", title: "Ajustar el inventario de filamento", category: "Inventario y compras", path: "/app/inventario/filamentos",
    summary: "Registra el consumo de filamento o corrige la existencia mediante un conteo físico.",
    steps: ["Abre el ajuste del filamento desde Inventario → Filamentos.", "Elige el tipo de ajuste disponible y revisa si capturas una diferencia o la existencia final.", "Revisa la unidad indicada (g o kg), captura la cantidad y un motivo que explique el movimiento.", "Guarda y comprueba la existencia y el historial resultantes."],
    notes: ["No confundas kg de compra con gramos de inventario. Si registras la existencia final contada, no captures de nuevo esa cantidad como una entrada."], related: ["filamentos", "inventario", "produccion"] },
  { id: "compras", title: "Registrar una compra con varias partidas", category: "Inventario y compras", path: "/app/compras",
    summary: "Registra productos, insumos, filamentos y gastos en un mismo comprobante.",
    steps: ["Abre Compras → Registrar compra o gasto y busca los artículos.", "Agrega todas las partidas necesarias y ajusta cantidades y costos unitarios reales.", "Usa Agregar servicio u Otro gasto para conceptos sin inventario, como mensajería o renta.", "Marca Compra pagada si ya se liquidó y selecciona la fecha real del pago. Si no, registra los abonos después desde el detalle.", "Revisa el total y guarda. Las partidas físicas dan entrada al inventario en la misma operación."],
    notes: ["El costo de catálogo se carga como referencia y puedes cambiarlo para esta compra sin sobrescribir el catálogo.", "El filamento se compra en kg y entra como gramos. Los productos fabricados no se compran desde este módulo."], related: ["costos-catalogo", "cancelar-gasto", "inventario"] },
  { id: "cancelar-gasto", title: "Cancelar un gasto y sus pagos", category: "Inventario y compras", path: "/app/compras",
    summary: "Anula una compra o gasto conservando su documento y movimientos de reversa.",
    steps: ["Abre el detalle del gasto y pulsa Cancelar gasto y pagos.", "Revisa que se trate del comprobante correcto y captura el motivo.", "Confirma. Se cancelan sus abonos y el saldo queda en cero.", "Si generó inventario, se revierten las entradas. Revisa el resultado en el detalle y en los movimientos."],
    notes: ["La cancelación se bloquea si hay existencias reservadas o insuficientes, salidas posteriores del artículo o lotes asociados a bobinas.", "La acción no devuelve dinero mediante bancos ni procesadores de pago. No modifica los costos del catálogo.", "Si una partida impide revertir la compra, no se cancela parcialmente. Para volver a registrar el gasto, crea otra compra."], related: ["compras", "inventario"] },
  { id: "recetas", title: "Configurar una receta de fabricación", category: "Fabricación", path: "/app/recetas",
    summary: "Define materiales y servicios necesarios por cada pieza terminada.",
    steps: ["Selecciona el producto fabricado y abre la edición de su receta.", "Agrega cada filamento o insumo con la cantidad por pieza y la merma que corresponda.", "Agrega los servicios por pieza en su sección, separados de los materiales.", "Comprueba los subtotales y el costo por pieza; revisa si hay conceptos sin costo configurado.", "Crea nuevas órdenes de producción para utilizar la receta actualizada."],
    notes: ["La cantidad de una receta es por pieza: para diez piezas se multiplican sus requerimientos, incluyendo merma.", "Los costos de la receta provienen del catálogo. Las órdenes ya creadas conservan sus cantidades y costos históricos; actualizar el catálogo no reescribe esos registros."], example: "Si cada pieza requiere 100 g y 2 tornillos, diez piezas necesitan 1,000 g y 20 tornillos, antes de agregar la merma configurada.", related: ["fabricados", "costos-catalogo", "produccion"] },
  { id: "produccion", title: "Crear y terminar órdenes de producción", category: "Fabricación", path: "/app/produccion",
    summary: "Fabrica productos terminados con receta y da entrada a las piezas resultantes.",
    steps: ["Selecciona un producto fabricable con receta y captura la cantidad de piezas, o genera órdenes desde un pedido confirmado.", "Revisa el material requerido y las existencias de insumos antes de avanzar.", "Usa la acción disponible de la orden para confirmarla o terminarla según su estado.", "Comprueba las piezas terminadas, el estado y su entrada de inventario. Si está ligada a un pedido, revisa también ese pedido."],
    notes: ["Puedes procesar órdenes diferentes sin que una acción bloquee todos los renglones. Evita repetir la misma acción en una orden que todavía está procesándose.", "Los insumos físicos se consumen en fabricación y requieren existencias. El filamento tiene control manual en el flujo actual: puede fabricarse sin stock y su consumo se registra por ajuste.", "Los servicios de impresión de un pedido no se operan aquí como si fueran productos terminados de catálogo."], related: ["recetas", "revisar-material", "cancelar-produccion"] },
  { id: "revisar-material", title: "Revisar materiales de varias órdenes", category: "Fabricación", path: "/app/produccion",
    summary: "Planea el gasto conjunto de filamentos, insumos y servicios.",
    steps: ["Selecciona las órdenes con sus casillas. La casilla del encabezado selecciona la página actual.", "Puedes seguir seleccionando en otras páginas y consultar el número de órdenes seleccionadas.", "Pulsa Revisar gasto de material para abrir el desglose agrupado.", "Consulta las cantidades, unidades, subtotales y el total estimado. Limpia la selección cuando termines."],
    notes: ["La estimación usa las recetas y costos vigentes y la cantidad completa de piezas de cada orden, sin restar lo ya terminado o consumido.", "Incluye merma y subrecetas. No reserva ni descuenta inventario. Si falta un costo, los totales afectados quedan sin calcular.", "El operador puede consultar cantidades, pero no los importes. Se permiten hasta 1,000 órdenes por consulta."], related: ["produccion", "recetas"] },
  { id: "cancelar-produccion", title: "Cancelar una orden de producción", category: "Fabricación", path: "/app/produccion",
    summary: "Detén una orden cuando su estado todavía permite cancelarla.",
    steps: ["Abre la orden o utiliza su acción de cancelación en el listado.", "Revisa su estado y los movimientos que ya se realizaron.", "Indica un motivo y confirma la cancelación si el sistema lo permite.", "Comprueba después el inventario y el pedido vinculado, cuando exista."],
    notes: ["Cancelar no significa fabricar las piezas ni registrar un reembolso. La cancelación libera los apartados pendientes; no devuelve automáticamente los materiales ya consumidos. Revisa los movimientos antes de continuar."], related: ["produccion", "inventario"] },
  { id: "calculadora", title: "Utilizar la calculadora de costo", category: "Catálogos", path: "/app/costeo",
    summary: "Estima el costo antes de fijar un precio comercial.",
    steps: ["Abre la calculadora y captura los materiales, cantidades y conceptos disponibles.", "Revisa las unidades y los costos utilizados en cada cálculo.", "Compara el resultado con el precio de venta que deseas ofrecer y utiliza las acciones disponibles para continuar la captura."],
    notes: ["Una estimación de costo no registra una compra, no fabrica unidades y no genera un cobro. El operador no tiene acceso a esta pantalla."], related: ["costos-catalogo", "recetas"] },
  { id: "configuracion", title: "Configurar el taller", category: "Administración", path: "/app/configuracion",
    summary: "Revisa los datos de la empresa y los valores por defecto antes de operar.",
    steps: ["Confirma nombre, RFC, régimen y código postal fiscal de la empresa.", "Configura los valores por defecto de IVA e ISR que correspondan a tu operación.", "Revisa los métodos de pago habilitados y demás opciones disponibles.", "Guarda y comprueba cómo se aplican los valores por defecto en nuevas capturas."],
    notes: ["La configuración fiscal solo puede editarla el dueño del taller. Cambiar un valor por defecto no significa recalcular todos los documentos históricos."], related: ["impuestos-descuentos", "equipo", "sucursales"] },
  { id: "sucursales", title: "Administrar sucursales y ubicaciones", category: "Administración", path: "/app/sucursales",
    summary: "Identifica dónde se reciben y utilizan los artículos físicos.",
    steps: ["Revisa las ubicaciones del taller y sus datos.", "Da de alta o actualiza una ubicación según los permisos de tu rol.", "Comprueba la ubicación utilizada al registrar entradas, pedidos y fabricación."],
    notes: ["Las existencias se controlan por ubicación. Tener unidades en otra ubicación no garantiza disponibilidad en la que usa una operación."], related: ["inventario", "compras"] },
  { id: "equipo", title: "Invitar al equipo y asignar roles", category: "Administración", path: "/app/equipo",
    summary: "Da acceso al taller con permisos acordes a cada responsabilidad.",
    steps: ["Invita a la persona con su correo y selecciona el rol adecuado.", "Comparte el enlace de invitación para que complete su acceso.", "Revisa las invitaciones pendientes y renueva o revoca las que corresponda.", "Actualiza el rol o retira integrantes cuando cambien sus responsabilidades."],
    notes: ["El operador atiende ventas, cobros, inventario y fabricación sin acceder a costos ni márgenes, y sin editar clientes, cotizaciones o pedidos ya creados.", "El rol de consulta permite leer los módulos autorizados sin crear ni editar. El dueño conserva las acciones administrativas exclusivas.", "No puedes cambiar tu propio rol ni darte de baja desde la administración del equipo. Los permisos no se amplían al abrir una ayuda."], related: ["inicio", "configuracion"] },
];

export function helpTopic(id: string): HelpTopic {
  const topic = HELP_TOPICS.find(item => item.id === id);
  if (!topic) throw new Error(`Tema de ayuda inexistente: ${id}`);
  return topic;
}
export function visibleHelpTopics(role: TenantRole | null): HelpTopic[] {
  return role ? HELP_TOPICS.filter(topic => !topic.path || canAccessPath(role, topic.path)) : [];
}
export function searchHelpTopics(topics: HelpTopic[], query: string): HelpTopic[] {
  const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  return topics.filter(topic => words.every(word => normalize([topic.title,topic.summary,topic.category,...topic.steps,...(topic.notes ?? [])].join(" ")).includes(word)));
}
export function pageHelpTopic(path: string): HelpTopic | undefined {
  if (path === "/app/ayuda" || path.startsWith("/app/plataforma")) return undefined;
  const routes: Array<[string,string]> = [["/app/productos/reventa","reventa"],["/app/productos/fabricados","fabricados"],["/app/productos","catalogos"],["/app/insumos","insumos"],["/app/filamentos","filamentos"],["/app/servicios","servicios"],["/app/clientes","clientes"],["/app/cotizaciones","cotizaciones"],["/app/pedidos","pedidos"],["/app/cobranza","cobranza"],["/app/punto-de-venta","punto-venta"],["/app/compras","compras"],["/app/inventario","inventario"],["/app/recetas","recetas"],["/app/produccion","produccion"],["/app/costeo","calculadora"],["/app/configuracion","configuracion"],["/app/equipo","equipo"],["/app/sucursales","sucursales"]];
  const match = routes.find(([prefix]) => path === prefix || path.startsWith(prefix+"/"));
  return match ? helpTopic(match[1]) : path === "/app" || path === "/app/" ? helpTopic("dashboard") : undefined;
}
