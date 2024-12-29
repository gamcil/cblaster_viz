# cblaster visualisation v2

```
git clone git@github.com:gamcil/cblaster_viz.git
cd cblaster_viz/
python3 -m http.server
```

Change dataURL in `loadData()` from `scripts.js` to use different data in served app.

Use `combine.py` to merge everything into a single portable HTML:

```
cd cblaster_viz/
python3 combine.py merged.html

or

python3 combine.py --js scripts.js --css style.css --html index.html --data testdata.json merged.html
```

### TODOs
* filtering by taxonomy
* sorting by score/length
* mouseover hit info
* row selection
