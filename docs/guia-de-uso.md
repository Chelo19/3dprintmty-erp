# Guía de uso de 3dprintnow

La guía interactiva está en **Guía de uso**, en la barra lateral de la aplicación (`/app/ayuda`). Cada pantalla tiene **Ayuda de esta pantalla** y las funciones principales incluyen botones de información. Los temas y accesos visibles dependen del rol.

Esta versión de consulta reúne todos los temas. La fuente del contenido es `apps/web/src/help-content.ts`. No incluye módulos desactivados.

## Tu primer recorrido por 3dprintnow

Conoce el orden de trabajo y la diferencia entre vender, comprar y fabricar.

1. Revisa los datos del taller, sus impuestos y métodos de pago con la persona administradora.
2. Registra los artículos que utilizas: productos fabricados, productos de reventa, insumos, filamentos y servicios.
3. Da entrada a los artículos comprados desde Compras. Para los productos fabricados, configura primero su receta.
4. Registra al cliente. Usa Cotizaciones y Pedidos para trabajos por encargo, o Punto de venta para ventas de mostrador.
5. Consulta inventario, producción y cobranza para dar seguimiento a entregas y saldos.

**Antes de continuar:**

- Solo aparecen los módulos permitidos para tu rol. Un botón ausente o inhabilitado puede depender del rol, del estado del registro o de un requisito pendiente.
- Usa la búsqueda de esta guía o los botones de información de cada pantalla para consultar una tarea sin modificar datos.

## Leer el inicio del taller

Consulta el estado general antes de comenzar la jornada.

1. Revisa pedidos pendientes, producción abierta y artículos con inventario bajo.
2. Consulta los saldos y movimientos financieros si tu rol permite verlos.
3. Abre el módulo correspondiente para atender cada pendiente; el resumen no sustituye su detalle.

**Antes de continuar:**

- Las cifras monetarias y los módulos visibles dependen de tu rol. Los gastos cancelados no se suman a gastos ni cuentas por pagar.

Ruta del módulo: `/app`.

## Elegir el catálogo correcto

Separa lo que fabricas, lo que revendes y lo que consumes.

1. Productos fabricados: artículos terminados que produces mediante una receta.
2. Productos: artículos comprados para revender. Registra sus entradas en Compras.
3. Insumos: componentes y materiales que consumes en las recetas.
4. Filamentos: materiales de impresión; su compra se captura en kg y las existencias se manejan en gramos.
5. Servicios: trabajos o conceptos sin existencias físicas, como diseño o acabado.

**Antes de continuar:**

- Crear un artículo de catálogo no registra una compra ni da entrada a inventario.
- Los productos con fabricación habilitada no pueden comprarse desde Compras. Los costos del catálogo son valores por defecto; una compra con otro importe no los sobrescribe.

Ruta del módulo: `/app/productos/fabricados`.

## Registrar productos fabricados

Prepara un artículo terminado para producirlo y venderlo.

1. Abre Catálogo → Productos fabricados y crea el artículo con un SKU y nombre reconocibles.
2. Revisa su clasificación y precio de venta.
3. Configura sus filamentos, insumos y servicios en Recetas.
4. Crea una orden de producción para fabricar unidades y darles entrada al inventario.

**Antes de continuar:**

- El costo del producto con receta se calcula a partir de ella. Dar de alta el producto no fabrica unidades automáticamente.

Ruta del módulo: `/app/productos/fabricados`.

## Registrar productos de reventa

Administra artículos que compras y vendes sin fabricarlos.

1. Abre Catálogo → Productos y registra el artículo como comprable.
2. Define su costo por defecto y precio de venta cuando tu rol lo permita.
3. Registra una compra con su cantidad e importe real para llenar el inventario.
4. Véndelo desde un pedido o el punto de venta.

**Antes de continuar:**

- El importe de una compra puede ser diferente del costo de catálogo y queda conservado en esa compra.

Ruta del módulo: `/app/productos/reventa`.

## Administrar insumos

Registra componentes que se compran y se consumen al fabricar.

1. Registra el insumo con su SKU, nombre y unidad correspondiente.
2. Configura el costo por defecto desde el catálogo, si tienes permiso.
3. Da entrada mediante una compra y agrégalo a las recetas que lo utilizan.
4. Revisa sus existencias y movimientos desde Inventario → Insumos.

**Antes de continuar:**

- Los insumos se obtienen comprándolos; no se crean como órdenes de fabricación.

Ruta del módulo: `/app/insumos`.

## Administrar filamentos

Distingue el costo por kilogramo de las cantidades en gramos.

1. Registra material, color, diámetro y un SKU que distinga el filamento.
2. Captura el costo del catálogo por kg cuando tu rol permita editarlo.
3. En Compras, registra los kg recibidos; el sistema los convierte a gramos de inventario.
4. En las recetas, indica los gramos necesarios por pieza. Usa el ajuste de inventario para registrar consumo o corregir el conteo.

**Ejemplo:** Un kg equivale a 1,000 g. Si el costo de catálogo es $200 por kg, 100 g representan $20 de material, antes de merma.

**Antes de continuar:**

- El flujo actual permite fabricar aunque no haya existencias de filamento. Revisa y ajusta su consumo físico; la fabricación no lo descuenta automáticamente.

Ruta del módulo: `/app/filamentos`.

## Registrar servicios

Usa conceptos como diseño, acabado o mano de obra sin crear existencias.

1. Crea el servicio con nombre, código y unidad: minuto, hora, pieza o servicio.
2. Captura el costo y precio de venta según tus permisos.
3. Agrégalo a una cotización para venderlo o a una receta para incluirlo en su costo de fabricación.

**Antes de continuar:**

- Un servicio no genera entradas ni salidas de inventario. Comprar un servicio como gasto es distinto de registrar el servicio que vendes.

Ruta del módulo: `/app/servicios`.

## Entender costos y precios

Diferencia el costo por defecto, el costo real de compra y el precio de venta.

1. Costo de catálogo: referencia por defecto del artículo. Se utiliza para capturar compras y calcular recetas.
2. Costo de compra: importe real pagado o por pagar en esa compra. Puedes modificarlo sin cambiar el catálogo.
3. Costo de producto fabricado: resultado de los materiales, servicios y demás conceptos configurados en su receta.
4. Precio de venta: importe comercial que cobras al cliente; revisa descuentos e impuestos en cada operación.

**Antes de continuar:**

- Cambiar costos de filamentos, insumos o servicios en el catálogo actualiza los productos dependientes de esas recetas. Las compras y sus cancelaciones no sobrescriben esos costos.
- El operador puede consultar los catálogos sin ver costos ni márgenes.

Ruta del módulo: `/app/productos/fabricados`.

## Dar de alta y buscar clientes

Prepara el cliente para cotizar, vender y dar seguimiento al crédito.

1. Abre Clientes → Nuevo cliente y captura sus datos de identificación y contacto.
2. Si corresponde público en general, usa la casilla que completa su RFC genérico.
3. Captura los datos fiscales y de domicilio que tengas; calle, colonia y código postal no son obligatorios en el alta.
4. Busca y selecciona al cliente escribiendo su nombre en los campos con autocompletado de ventas.

**Antes de continuar:**

- Se permiten varios clientes con RFC de público en general XAXX010101000. Esa excepción no elimina la validación de los demás RFC.
- Revisa las condiciones y el límite de crédito antes de trabajar con pagos diferidos.

Ruta del módulo: `/app/clientes`.

## Crear y dar seguimiento a una cotización

Prepara una propuesta antes de convertirla en pedido.

1. Abre Cotizaciones → Nueva cotización y selecciona al cliente con el autocompletado.
2. Agrega artículos de catálogo o piezas temporales. Para impresiones, revisa cantidades, gramos y servicios por pieza.
3. Verifica precios, descuentos e impuestos de cada partida.
4. Define los días de validez, condiciones de pago y plazo de entrega que correspondan.
5. Guarda y revisa el detalle. Utiliza las acciones disponibles para compartir el PDF, enviar, aceptar o convertir en pedido, según su estado.

**Antes de continuar:**

- Una cotización no reserva ni descuenta inventario. El pedido es el que continúa el flujo de suministro y entrega.
- El operador puede crear cotizaciones, pero no editarlas después.

Ruta del módulo: `/app/cotizaciones`.

## Cotizar piezas temporales

Cotiza un concepto sin darlo de alta en ningún catálogo.

1. En la cotización, pulsa Agregar pieza temporal.
2. Escribe una descripción clara, cantidad e importe unitario.
3. Revisa su descuento e impuestos y guarda la cotización.

**Ejemplo:** PIEZA TEMPORAL 1 · 3 piezas · $332.42 por pieza = $997.26 antes de descuentos e impuestos.

**Antes de continuar:**

- La partida no crea un producto, una receta ni existencias. Para manejar fabricación con receta o inventario, registra el artículo correspondiente en el catálogo.

Ruta del módulo: `/app/cotizaciones`.

## Aplicar descuentos, IVA y retención ISR

Revisa los importes por partida antes de guardar o enviar una propuesta.

1. Captura el descuento en MXN sobre el total de la partida, no como porcentaje.
2. Revisa el IVA y la retención ISR de cada partida. Puedes tener partidas con porcentajes diferentes en la misma cotización.
3. Usa IVA 0 % cuando el concepto no lleve IVA. El ISR retenido se resta del total por cobrar.
4. Comprueba el total final después de descuentos, IVA y retenciones.

**Antes de continuar:**

- Los campos de IVA e ISR se muestran según los valores por defecto configurados en el taller. Si están desactivados o en cero, no se muestran en la captura.
- En impresiones de varias piezas, los gramos y servicios se capturan por pieza; el descuento corresponde al total de la partida.

Ruta del módulo: `/app/cotizaciones`.

## Trabajar un pedido

Da seguimiento desde el encargo hasta su entrega y cobro.

1. Crea el pedido con su cliente y partidas, o conviértelo desde una cotización aceptada.
2. Revisa las condiciones, cantidades y fecha compromiso antes de confirmar.
3. Confirma el pedido y atiende los requisitos que indique el sistema, como el límite de crédito.
4. Usa Apartar inventario para unidades disponibles o Ir a producción para artículos fabricables pendientes.
5. Da seguimiento a las acciones de entrega o prestación de cada partida y registra los cobros correspondientes.

**Antes de continuar:**

- Las acciones dependen del estado del pedido y de cada partida. Lee el motivo que aparece si un paso está bloqueado.
- Marcar un servicio como Prestado registra su realización; no equivale a cobrarlo. Los artículos físicos requieren el movimiento de inventario correspondiente y no pueden entregarse sin unidades disponibles.

Ruta del módulo: `/app/pedidos`.

## Apartar inventario o mandar a producción

Elige cómo cubrir las unidades físicas del pedido.

1. Consulta la cantidad requerida y las existencias disponibles en el pedido.
2. Aparta las unidades existentes para reservarlas a este pedido.
3. Si faltan productos fabricables con receta, genera sus órdenes con Ir a producción.
4. Si falta un producto comprado, registra su compra o entrada antes de intentar entregarlo.

**Antes de continuar:**

- Apartar reserva unidades; no es una entrega ni un cobro. Las unidades apartadas reducen la disponibilidad para otros pedidos.
- Una partida de impresión o un servicio no sigue el mismo flujo que un producto terminado con receta.

Ruta del módulo: `/app/pedidos`.

## Revisar el límite de crédito

Comprueba la exposición del cliente antes de autorizar nuevos pedidos a crédito.

1. Revisa el límite y las condiciones configuradas para el cliente.
2. Registra los abonos que ya recibió el taller para que sus saldos estén actualizados.
3. Si el pedido supera el límite, una persona con permiso debe revisar y autorizar la excepción con un motivo, cuando corresponda.

**Antes de continuar:**

- Una autorización de crédito no liquida el saldo. El motivo se conserva en el pedido.
- Que un usuario pueda crear un pedido no significa que pueda autorizar excepciones de crédito.

Ruta del módulo: `/app/pedidos`.

## Registrar cobros y abonos de clientes

Registra cuándo y cómo pagó el cliente y consulta el saldo restante.

1. Abre Cobranza y selecciona el pedido o usa su acción de registrar abono.
2. Captura el importe recibido y el método de pago.
3. Selecciona la fecha real en que se recibió el dinero; puede ser distinta de la fecha de captura.
4. Guarda y revisa el estado del movimiento y el saldo del pedido.
5. Los movimientos contra entrega pueden quedar pendientes; confírmalos cuando realmente se reciba el pago.

**Antes de continuar:**

- Un abono parcial reduce el saldo sin liquidarlo. Un cobro pendiente no es dinero recibido.
- No registres nuevamente un pago solo porque aún no ves actualizado el saldo: comprueba antes el detalle y el estado del movimiento.

Ruta del módulo: `/app/cobranza`.

## Hacer una venta de mostrador

Cobra y entrega una venta inmediata desde una sola pantalla.

1. Busca artículos y usa los filtros de servicio, producto terminado o producto.
2. Agrega las partidas a la venta y ajusta sus cantidades.
3. Revisa el total, el método de pago y, si corresponde, el efectivo recibido y el cambio.
4. Confirma la venta. Consulta o reimprime el ticket desde el historial.

**Antes de continuar:**

- Por defecto se ocultan los productos sin existencias. Mostrar los no disponibles no permite vender unidades que no existen.
- La venta de mostrador registra el cobro completo y la salida de los artículos físicos. Para un encargo con fabricación o pagos posteriores, usa Cotizaciones y Pedidos.

Ruta del módulo: `/app/punto-de-venta`.

## Consultar existencias y movimientos

Distingue existencias físicas, unidades apartadas y disponibilidad.

1. Elige la sección: productos fabricados, productos, insumos o filamentos.
2. Busca el artículo y revisa sus existencias, apartados y disponibilidad.
3. Abre su historial para consultar entradas, salidas, fechas y referencias.
4. Registra compras para artículos adquiridos y producción para terminados fabricados. Usa ajustes solo para corregir el inventario físico o registrar movimientos justificados.

**Antes de continuar:**

- El catálogo describe el artículo; el inventario refleja sus cantidades y movimientos.
- Registra un motivo claro en los ajustes. Una corrección de existencias no sustituye el registro de un gasto o un cobro.

Ruta del módulo: `/app/inventario/filamentos`.

## Ajustar el inventario de filamento

Registra el consumo de filamento o corrige la existencia mediante un conteo físico.

1. Abre el ajuste del filamento desde Inventario → Filamentos.
2. Elige el tipo de ajuste disponible y revisa si capturas una diferencia o la existencia final.
3. Revisa la unidad indicada (g o kg), captura la cantidad y un motivo que explique el movimiento.
4. Guarda y comprueba la existencia y el historial resultantes.

**Antes de continuar:**

- No confundas kg de compra con gramos de inventario. Si registras la existencia final contada, no captures de nuevo esa cantidad como una entrada.

Ruta del módulo: `/app/inventario/filamentos`.

## Registrar una compra con varias partidas

Registra productos, insumos, filamentos y gastos en un mismo comprobante.

1. Abre Compras → Registrar compra o gasto y busca los artículos.
2. Agrega todas las partidas necesarias y ajusta cantidades y costos unitarios reales.
3. Usa Agregar servicio u Otro gasto para conceptos sin inventario, como mensajería o renta.
4. Marca Compra pagada si ya se liquidó y selecciona la fecha real del pago. Si no, registra los abonos después desde el detalle.
5. Revisa el total y guarda. Las partidas físicas dan entrada al inventario en la misma operación.

**Antes de continuar:**

- El costo de catálogo se carga como referencia y puedes cambiarlo para esta compra sin sobrescribir el catálogo.
- El filamento se compra en kg y entra como gramos. Los productos fabricados no se compran desde este módulo.

Ruta del módulo: `/app/compras`.

## Cancelar un gasto y sus pagos

Anula una compra o gasto conservando su documento y movimientos de reversa.

1. Abre el detalle del gasto y pulsa Cancelar gasto y pagos.
2. Revisa que se trate del comprobante correcto y captura el motivo.
3. Confirma. Se cancelan sus abonos y el saldo queda en cero.
4. Si generó inventario, se revierten las entradas. Revisa el resultado en el detalle y en los movimientos.

**Antes de continuar:**

- La cancelación se bloquea si hay existencias reservadas o insuficientes, salidas posteriores del artículo o lotes asociados a bobinas.
- La acción no devuelve dinero mediante bancos ni procesadores de pago. No modifica los costos del catálogo.
- Si una partida impide revertir la compra, no se cancela parcialmente. Para volver a registrar el gasto, crea otra compra.

Ruta del módulo: `/app/compras`.

## Configurar una receta de fabricación

Define materiales y servicios necesarios por cada pieza terminada.

1. Selecciona el producto fabricado y abre la edición de su receta.
2. Agrega cada filamento o insumo con la cantidad por pieza y la merma que corresponda.
3. Agrega los servicios por pieza en su sección, separados de los materiales.
4. Comprueba los subtotales y el costo por pieza; revisa si hay conceptos sin costo configurado.
5. Crea nuevas órdenes de producción para utilizar la receta actualizada.

**Ejemplo:** Si cada pieza requiere 100 g y 2 tornillos, diez piezas necesitan 1,000 g y 20 tornillos, antes de agregar la merma configurada.

**Antes de continuar:**

- La cantidad de una receta es por pieza: para diez piezas se multiplican sus requerimientos, incluyendo merma.
- Los costos de la receta provienen del catálogo. Las órdenes ya creadas conservan sus cantidades y costos históricos; actualizar el catálogo no reescribe esos registros.

Ruta del módulo: `/app/recetas`.

## Crear y terminar órdenes de producción

Fabrica productos terminados con receta y da entrada a las piezas resultantes.

1. Selecciona un producto fabricable con receta y captura la cantidad de piezas, o genera órdenes desde un pedido confirmado.
2. Revisa el material requerido y las existencias de insumos antes de avanzar.
3. Usa la acción disponible de la orden para confirmarla o terminarla según su estado.
4. Comprueba las piezas terminadas, el estado y su entrada de inventario. Si está ligada a un pedido, revisa también ese pedido.

**Antes de continuar:**

- Puedes procesar órdenes diferentes sin que una acción bloquee todos los renglones. Evita repetir la misma acción en una orden que todavía está procesándose.
- Los insumos físicos se consumen en fabricación y requieren existencias. El filamento tiene control manual en el flujo actual: puede fabricarse sin stock y su consumo se registra por ajuste.
- Los servicios de impresión de un pedido no se operan aquí como si fueran productos terminados de catálogo.

Ruta del módulo: `/app/produccion`.

## Revisar materiales de varias órdenes

Planea el gasto conjunto de filamentos, insumos y servicios.

1. Selecciona las órdenes con sus casillas. La casilla del encabezado selecciona la página actual.
2. Puedes seguir seleccionando en otras páginas y consultar el número de órdenes seleccionadas.
3. Pulsa Revisar gasto de material para abrir el desglose agrupado.
4. Consulta las cantidades, unidades, subtotales y el total estimado. Limpia la selección cuando termines.

**Antes de continuar:**

- La estimación usa las recetas y costos vigentes y la cantidad completa de piezas de cada orden, sin restar lo ya terminado o consumido.
- Incluye merma y subrecetas. No reserva ni descuenta inventario. Si falta un costo, los totales afectados quedan sin calcular.
- El operador puede consultar cantidades, pero no los importes. Se permiten hasta 1,000 órdenes por consulta.

Ruta del módulo: `/app/produccion`.

## Cancelar una orden de producción

Detén una orden cuando su estado todavía permite cancelarla.

1. Abre la orden o utiliza su acción de cancelación en el listado.
2. Revisa su estado y los movimientos que ya se realizaron.
3. Indica un motivo y confirma la cancelación si el sistema lo permite.
4. Comprueba después el inventario y el pedido vinculado, cuando exista.

**Antes de continuar:**

- Cancelar no significa fabricar las piezas ni registrar un reembolso. La cancelación libera los apartados pendientes; no devuelve automáticamente los materiales ya consumidos. Revisa los movimientos antes de continuar.

Ruta del módulo: `/app/produccion`.

## Utilizar la calculadora de costo

Estima el costo antes de fijar un precio comercial.

1. Abre la calculadora y captura los materiales, cantidades y conceptos disponibles.
2. Revisa las unidades y los costos utilizados en cada cálculo.
3. Compara el resultado con el precio de venta que deseas ofrecer y utiliza las acciones disponibles para continuar la captura.

**Antes de continuar:**

- Una estimación de costo no registra una compra, no fabrica unidades y no genera un cobro. El operador no tiene acceso a esta pantalla.

Ruta del módulo: `/app/costeo`.

## Configurar el taller

Revisa los datos de la empresa y los valores por defecto antes de operar.

1. Confirma nombre, RFC, régimen y código postal fiscal de la empresa.
2. Configura los valores por defecto de IVA e ISR que correspondan a tu operación.
3. Revisa los métodos de pago habilitados y demás opciones disponibles.
4. Guarda y comprueba cómo se aplican los valores por defecto en nuevas capturas.

**Antes de continuar:**

- La configuración fiscal solo puede editarla el dueño del taller. Cambiar un valor por defecto no significa recalcular todos los documentos históricos.

Ruta del módulo: `/app/configuracion`.

## Administrar sucursales y ubicaciones

Identifica dónde se reciben y utilizan los artículos físicos.

1. Revisa las ubicaciones del taller y sus datos.
2. Da de alta o actualiza una ubicación según los permisos de tu rol.
3. Comprueba la ubicación utilizada al registrar entradas, pedidos y fabricación.

**Antes de continuar:**

- Las existencias se controlan por ubicación. Tener unidades en otra ubicación no garantiza disponibilidad en la que usa una operación.

Ruta del módulo: `/app/sucursales`.

## Invitar al equipo y asignar roles

Da acceso al taller con permisos acordes a cada responsabilidad.

1. Invita a la persona con su correo y selecciona el rol adecuado.
2. Comparte el enlace de invitación para que complete su acceso.
3. Revisa las invitaciones pendientes y renueva o revoca las que corresponda.
4. Actualiza el rol o retira integrantes cuando cambien sus responsabilidades.

**Antes de continuar:**

- El operador atiende ventas, cobros, inventario y fabricación sin acceder a costos ni márgenes, y sin editar clientes, cotizaciones o pedidos ya creados.
- El rol de consulta permite leer los módulos autorizados sin crear ni editar. El dueño conserva las acciones administrativas exclusivas.
- No puedes cambiar tu propio rol ni darte de baja desde la administración del equipo. Los permisos no se amplían al abrir una ayuda.

Ruta del módulo: `/app/equipo`.

