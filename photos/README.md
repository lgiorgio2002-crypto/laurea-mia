# Foto

Metti qui le tue foto da bambino con questi nomi esatti:

```
1.jpg
2.jpg
3.jpg
...
12.jpg
```

**`1.jpg` ha un ruolo speciale**: diventa lo scatto grande di apertura,
subito sotto il titolo. Sceglila di conseguenza e possibilmente orizzontale,
perche' occupa tutta la larghezza. Tutte le altre finiscono nella striscia
scorrevole della sezione "Da dove e' partito tutto".

Puoi usarne meno di 12 (i file mancanti vengono semplicemente saltati)
o di piu': in quel caso apri `script.js` e cambia il numero `12` nella riga

```js
const PHOTO_MANIFEST = Array.from({ length: 12 }, (_, i) => `photos/${i + 1}.jpg`);
```

Formato consigliato: `.jpg`. Le foto della striscia vengono ritagliate
automaticamente in verticale (4:5), qualunque sia la proporzione di partenza,
quindi non serve editarle a mano.

Nota sulla qualita': in questo stile le foto vengono mostrate grandi, quindi
le scansioni molto a bassa risoluzione si vedono. Se hai gli originali,
scansionali ad almeno 1500px sul lato lungo.
