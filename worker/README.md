# Il muro condiviso

Un Cloudflare Worker che conserva le foto del traguardo, cifrate nel telefono
con la chiave del QR. Qui non arrivano mai la chiave né una foto in chiaro.

## Messa online

Dalla cartella `worker/`:

1. `npx wrangler login`
2. `npx wrangler kv namespace create WALL`, poi copia l'`id` in `wrangler.toml`
3. In `wrangler.toml` imposta `CLOSES_AT`: sette giorni dalla pubblicazione
4. `node admin.js pass-hash | npx wrangler secret put UPLOAD_PASS_HASH`
5. `npx wrangler secret put ADMIN_TOKEN` e scegli una stringa lunga e casuale
6. `npx wrangler deploy`
7. Copia l'indirizzo del Worker in `WALL_API`, dentro `chapters.js`

## Controllare il muro

Dalla cartella del progetto, con `WALL_API` nell'ambiente:

- `node worker/admin.js download` decifra tutto in `private/wall/`
- `node worker/admin.js remove <id>` toglie una foto, l'id è il nome del file
  (serve anche `WALL_ADMIN_TOKEN`)

## Limiti

Una foto al massimo 1,5 MB, 12 caricamenti l'ora per indirizzo, 300 foto in
tutto. Sul telefono il muro ne mostra al massimo 60. Dopo `CLOSES_AT` non si
carica più, ma chi ha il QR continua a vedere il muro.

Prima di spegnere il Worker, lancia `download`: è l'unica copia.
