# Foto

Questa cartella è pubblica, quindi contiene solo foto **cifrate** (`N.bin`)
e l'elenco `manifest.json`. Senza la chiave del QR sono illeggibili.

Gli originali stanno in `private/photos/` (`1.jpeg`, `2.jpeg`, ...), che git
ignora e che non deve mai essere pubblicata.

## Aggiungere, togliere o riordinare foto

1. Modifica i file in `private/photos/`. Il numero è l'ordine; `1.jpeg` è lo
   scatto grande di apertura. L'estensione deve essere `.jpeg`, minuscola.
2. Esegui `node build.js` dalla cartella del progetto: rigenera i `.bin` e
   l'elenco, e toglie quelli delle foto cancellate.
3. Commit e push della cartella `photos/`.

## La chiave

Sta in `secret.key` (anche questo ignorato da git). **Non deve mai cambiare**
dopo la stampa del QR, altrimenti il QR della tesi non apre più le foto.
Se il file va perso, la chiave si recupera scansionando il QR stampato: è la
parte dell'indirizzo dopo il `#`.
