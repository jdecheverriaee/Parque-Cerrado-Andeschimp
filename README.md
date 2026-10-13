# Andeschimp · Parque Cerrado

Control de ingreso y retiro de bicicletas al parque cerrado. Funciona escaneando el QR del chip MYLAPS ThinTag con la cámara del celular.

- `index.html` es el **escáner**, pensado para el celular del staff en la puerta.
- `dashboard.html` es el **dashboard**: bicis dentro del parque, métricas, gráficos y CSV.
- `apps-script/Code.gs` es el **backend**: guarda cada escaneo en Google Sheets.

```
Celular (escáner) ──POST──▶ Apps Script ──▶ Google Sheet "Registros"
Dashboard        ──POST──▶ Apps Script ◀── Google Sheet "Participantes" (opcional)
```

Si `API_URL` está vacío en `assets/config.js`, la app corre en **modo demo**: guarda los datos solo en ese navegador y trae datos de ejemplo.

## Puesta en marcha

### 1. Google Sheet + Apps Script
1. Crea un Google Sheet nuevo, por ejemplo "Parque Cerrado 2026".
2. Abre **Extensiones → Apps Script**, borra el contenido y pega `apps-script/Code.gs`.
3. En **Configuración del proyecto**, pon la zona horaria en `America/Santiago`.
4. En el selector de funciones elige `setup` y presiona **Ejecutar**. Acepta los permisos.
   Esto crea las hojas `Registros` y `Participantes` y genera el **PIN**, que aparece en el *Registro de ejecución*.
   Para cambiar el PIN: **Configuración del proyecto → Propiedades del script → `API_KEY`**.
5. Publica con **Implementar → Nueva implementación → Aplicación web**:
   - *Ejecutar como*: **Yo**
   - *Quién tiene acceso*: **Cualquier usuario**
6. Copia la URL que termina en `/exec`.

> Cada vez que cambies `Code.gs` tienes que ir a **Implementar → Administrar implementaciones → Editar → Nueva versión**. Así la URL no cambia.

### 2. Web
1. En `assets/config.js` pon la URL en `API_URL` y, si quieres, el enlace al Sheet en `SHEET_URL`.
2. Publica la carpeta en Vercel (u otro hosting con **HTTPS**, porque la cámara no funciona sin HTTPS).
3. En cada celular abre la web, toca ⚙️ e ingresa el **nombre del puesto** y el **PIN**.

### 3. Participantes (opcional)
En la hoja `Participantes` pega el listado con las columnas **Código | Dorsal | Nombre | Categoría**. Lo puedes exportar desde el software de MYLAPS o desde la inscripción. Así el escáner y el dashboard muestran el dorsal y el nombre de cada chip.

## Cómo funciona

- **Modo Auto** (recomendado): si el chip estaba fuera queda como INGRESO, y si estaba dentro queda como RETIRO.
- **Ingreso / Retiro**: fuerzan el tipo. Úsalos si hay una puerta solo de entrada y otra solo de salida.
- **Lecturas dobles**: el mismo chip escaneado otra vez dentro de 20 s no se registra de nuevo y se muestra como "Ya registrado".
- **Avisos en rojo**: aparecen cuando entra un chip que ya figuraba dentro o se retira uno que no tenía ingreso.
- **Sin conexión**: los escaneos quedan en cola en el celular y se envían solos al volver la señal. No se duplican, porque cada escaneo lleva un ID único.
- **Código del chip**: se guarda el texto del QR normalizado (sin espacios y en mayúsculas). Si el QR es una URL, se toma el parámetro `chip`/`code`/`id` o el último tramo de la ruta. El QR original queda en la columna `QR original`.
- **Dashboard**: se actualiza cada 15 s. Muestra bicis dentro ahora, ingresos, retiros, bicis distintas, permanencia promedio y ocupación máxima. Se puede filtrar por día o ver todo el historial. Destaca en naranjo las bicis con más de 6 h dentro.

## Desarrollo local
```bash
python3 -m http.server 5178
```
Abre http://localhost:5178. Con `API_URL` vacío usa el modo demo.
