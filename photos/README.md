# Foto

Metti qui le tue foto da bambino con questi nomi esatti:

```
1.jpg
2.jpg
3.jpg
...
12.jpg
```

Puoi usarne meno di 12 (le caselle mancanti vengono semplicemente ignorate)
o di più: in quel caso apri `script.js` e cambia il numero `12` nella riga

```js
const PHOTO_MANIFEST = Array.from({ length: 12 }, (_, i) => `photos/${i + 1}.jpg`);
```

Formato consigliato: `.jpg`, orientamento verticale o quadrato (la griglia
ritaglia automaticamente qualsiasi proporzione, non serve editarle a mano).
