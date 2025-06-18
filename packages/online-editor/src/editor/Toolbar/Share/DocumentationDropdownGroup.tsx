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

import React, { useCallback, useMemo } from "react";
import { DropdownGroup, DropdownItem } from "@patternfly/react-core/deprecated";
import FileIcon from "@patternfly/react-icons/dist/js/icons/file-icon";
import { WorkspaceFile } from "@kie-tools-core/workspaces-git-fs/dist/context/WorkspacesContext";
import { ActiveWorkspace } from "@kie-tools-core/workspaces-git-fs/dist/model/ActiveWorkspace";
import { EmbeddedEditorRef } from "@kie-tools-core/editor/dist/embedded";

type Props = {
  workspaceFile: WorkspaceFile;
  workspace: ActiveWorkspace;
  editor: EmbeddedEditorRef | undefined;
  onGenerateAll: () => void;
  onGenerateSelected: () => void;
};

export const DocumentationDropdownGroup = (props: Props) => {
  const shouldShowDocumentationGroup = useMemo(() => {
    // Only show documentation generation for DMN files
    return props.workspaceFile.extension.toLowerCase() === "dmn";
  }, [props.workspaceFile]);

  const onGenerateAllDmnDocumentation = useCallback(() => {
    console.log("🚀 Generate All DMN Documentation clicked");
    props.onGenerateAll();
  }, [props.onGenerateAll]);

  const onGenerateSelectedDmnDocumentation = useCallback(() => {
    console.log("🚀 Generate Selected DMN Documentation clicked");
    props.onGenerateSelected();
  }, [props.onGenerateSelected]);

  if (!shouldShowDocumentationGroup) {
    return null;
  }

  return (
    <DropdownGroup key={"documentation-group"} label="Generate Documentation">
      <DropdownItem
        onClick={onGenerateAllDmnDocumentation}
        key={"generate-all-dmn-documentation-item"}
        description={"Generate a PDF with DMN Diagram, Data-type List etc"}
        icon={<FileIcon />}
        ouiaId="generate-all-dmn-documentation-button"
      >
        All DMNs
      </DropdownItem>
      <DropdownItem
        onClick={onGenerateSelectedDmnDocumentation}
        key={"generate-selected-dmn-documentation-item"}
        description={"Creates diagrams, data types, and boxed expressions for selected DMN files."}
        icon={<FileIcon />}
        ouiaId="generate-selected-dmn-documentation-button"
      >
        Selected DMNs Only
      </DropdownItem>
    </DropdownGroup>
  );
};
