# Foto

Questa cartella è pubblica, quindi contiene solo foto **cifrate** (`N.bin`)
e l'elenco `manifest.json`. Senza la chiave del QR sono illeggibili.

Tutto ciò che è privato sta in `private/`, che git ignora e che non deve mai
essere pubblicata:
- `private/photos/` — le foto pronte (`1.jpeg`, `2.jpeg`, ...), senza metadati;
- `private/originals/` — gli originali della fotocamera, solo come copia.

## Aggiungere, togliere o riordinare foto

1. Metti le foto in `private/photos/` con nomi come `32.jpeg` (estensione
   minuscola). Il numero è l'ordine.
2. Esegui `node build.js` dalla cartella del progetto: cifra solo le foto
   nuove o cambiate e toglie quelle cancellate.
3. Commit e push della cartella `photos/`.

## Metadati

Chi ha la chiave decifra le foto così come sono: una foto della fotocamera
pubblicherebbe a tutti loro le coordinate GPS, il modello del telefono e
l'ora di scatto. Per questo `node build.js` **si ferma** se una foto
contiene EXIF, XMP o commenti, e dice quale. Va prima ripulita: ruotata
secondo i suoi metadati, ridimensionata a 1600px e salvata senza metadati.

## La chiave

Sta in `secret.key` (anche questo ignorato da git). **Non deve mai cambiare**
dopo la stampa del QR, altrimenti il QR della tesi non apre più le foto.
Se il file va perso, la chiave si recupera scansionando il QR stampato: è la
parte dell'indirizzo dopo il `#`.
