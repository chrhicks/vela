import { eslintCompatPlugin } from "@oxlint/plugins";

import { noManualEffectErrorTagRule } from "./rules/no-manual-effect-error-tag.ts";
import { noManualTagComparisonRule } from "./rules/no-manual-tag-comparison.ts";
import { noManualTaggedConstructionRule } from "./rules/no-manual-tagged-construction.ts";
import { noEndingEscapeRule } from './rules/no-ending-escape.ts'
import { noServiceGraphRule } from './rules/no-service-graph.ts'
import { preferEffectMatchRule } from "./rules/prefer-effect-match.ts";

const antiSlopEffectPlugin = eslintCompatPlugin({
	meta: { name: "anti-slop-effect" },
	rules: {
		"no-manual-effect-error-tag": noManualEffectErrorTagRule,
		"no-manual-tag-comparison": noManualTagComparisonRule,
		"no-manual-tagged-construction": noManualTaggedConstructionRule,
		'no-ending-escape': noEndingEscapeRule,
		'no-service-graph': noServiceGraphRule,
		"prefer-effect-match": preferEffectMatchRule,
	},
});

export default antiSlopEffectPlugin;
