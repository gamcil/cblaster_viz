import argparse


def main(js_path, css_path, html_path, data_path, output_path):
    with (
        open(js_path, 'r') as js,
        open(css_path, 'r') as css,
        open(html_path, 'r') as html,
        open(data_path, 'r') as data
    ):
        html_content = html.read()
        css_content = css.read()
        js_content = js.read()
        data_content = data.read()
        combined_html = (
            html_content
                .replace('<link href="./style.css" rel="stylesheet"/>', f'<style>{css_content}</style>')
                .replace('<script src="./scripts.js" defer></script>', f'<script defer>{js_content}</script>')
                .replace('</body>', f'<script type="application/json" id="data-json">{data_content}</script>\n</body>')
        )
    with open(output_path, 'w') as fp:
        fp.write(combined_html)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Merge JS/CSS/HTML/data into single HTML file")
    parser.add_argument("--js", help="path to scripts file", default="scripts.js")
    parser.add_argument("--css", help="path to CSS style file", default="style.css")
    parser.add_argument("--html", help="path to base HTML file", default="index.html")
    parser.add_argument("--data", help="path to data JSON file", default="testdata.json")
    parser.add_argument("output", help="Output HTML file")
    args = parser.parse_args()
    main(args.js, args.css, args.html, args.data, args.output)