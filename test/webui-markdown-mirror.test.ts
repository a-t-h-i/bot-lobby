import { test } from "node:test";
import assert from "node:assert/strict";
import { markdownRuns } from "../webui/src/app/composer/markdownMirror.ts";

const kinds = (text: string) => markdownRuns(text).map((run) => [run.text, run.kind]);

test("the composer's styled Markdown gives back the typed text exactly", () => {
  const text = "/plan **big** _it_ `x` [a](https://b.c)\n# T\n- [ ] one\n> q\n```\n**no**\n```\n2*3*4 snake_case\n";
  assert.equal(markdownRuns(text).map((run) => run.text).join(""), text);
});

test("marks stay, faint; emphasis, code, links and @names are styled; code is left alone", () => {
  assert.deepEqual(kinds("a **b** c"), [["a ", ""], ["**", "mark"], ["b", "strong"], ["**", "mark"], [" c", ""]]);
  assert.deepEqual(kinds("`**x**`"), [["`", "code mark"], ["**x**", "code"], ["`", "code mark"]]);
  assert.deepEqual(kinds("ask @dev"), [["ask ", ""], ["@dev", "mention"]]);
  assert.deepEqual(kinds("# Hi"), [["# ", "heading mark"], ["Hi", "heading"]]);
  assert.deepEqual(kinds("```\n*a*\n```"), [["```", "codeblock mark"], ["\n", ""], ["*a*", "codeblock"], ["\n", ""], ["```", "codeblock mark"]]);
  assert.deepEqual(kinds("2*3*4 snake_case_name"), [["2*3*4 snake_case_name", ""]]);
});
