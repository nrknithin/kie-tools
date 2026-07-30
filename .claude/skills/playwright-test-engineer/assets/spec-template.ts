/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *  http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

// TEMPLATE — copy into tests-e2e/<featureGroup>/<camelCaseScenario>.spec.ts, then:
//  - replace every <ANGLE_BRACKET> placeholder with real values discovered during package analysis
//  - only import fixtures that actually exist in ../__fixtures__/base — do not invent fixture names
//  - only import TestAnnotations if this spec pins a known regression/workaround
//  - path depth of "../__fixtures__/base" must match this file's actual folder depth under tests-e2e/

import { TestAnnotations } from "@kie-tools/playwright-base/annotations";
import { test, expect } from "../__fixtures__/base";

test.beforeEach(async ({ editor }) => {
  await editor.open();
});

test.describe("<Feature under test>", () => {
  test.describe("<Sub-scenario grouping>", () => {
    test("should <expected behavior, plain language>", async ({ /* <fixtures used, e.g. diagram, nodes, palette> */ }) => {
      // Optional — only when this test pins a known issue:
      // test.info().annotations.push({
      //   type: TestAnnotations.REGRESSION,
      //   description: "https://github.com/apache/incubator-kie-issues/issues/<NUMBER>",
      // });

      // Act: drive the UI through the page-object fixtures, not raw locators.
      // await palette.dragNewNode({ type: NodeType.<X>, targetPosition: { x: 100, y: 100 } });

      // Assert: functional assertion(s) first...
      // await expect(nodes.get({ name: "<expected node name>" })).toBeAttached();

      // ...then, if the scenario is visual, a screenshot assertion:
      // await expect(diagram.get()).toHaveScreenshot("<kebab-case-scenario-name>.png");

      // ...and, where the package exposes a model fixture, assert the underlying
      // model (XML/JSON) changed as expected — not just the DOM:
      // const element = await jsonModel.drgElements.get<...>({ ... });
      // expect(element).toEqual({ ... });
    });
  });
});
