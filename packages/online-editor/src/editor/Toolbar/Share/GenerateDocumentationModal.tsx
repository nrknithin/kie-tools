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

import React, { useCallback, useMemo, useState } from "react";
import { Modal, ModalVariant } from "@patternfly/react-core/dist/js/components/Modal";
import { Button, ButtonVariant } from "@patternfly/react-core/dist/js/components/Button";
import { SearchInput } from "@patternfly/react-core/dist/js/components/SearchInput";
import { Checkbox } from "@patternfly/react-core/dist/js/components/Checkbox";
import { Stack, StackItem } from "@patternfly/react-core/dist/js/layouts/Stack";
import { Text, TextContent, TextVariants } from "@patternfly/react-core/dist/js/components/Text";
import { WorkspaceFile } from "@kie-tools-core/workspaces-git-fs/dist/context/WorkspacesContext";
import { ActiveWorkspace } from "@kie-tools-core/workspaces-git-fs/dist/model/ActiveWorkspace";
import { EmbeddedEditorRef } from "@kie-tools-core/editor/dist/embedded";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  workspaceFile: WorkspaceFile;
  workspace: ActiveWorkspace;
  editor: EmbeddedEditorRef | undefined;
}

export const GenerateDocumentationModal = (props: Props) => {
  const [searchValue, setSearchValue] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

  // Get all DMN files from the workspace
  const dmnFiles = useMemo(() => {
    return props.workspace.files.filter((file: WorkspaceFile) => file.extension.toLowerCase() === "dmn");
  }, [props.workspace.files]);

  // Filter files based on search
  const filteredFiles = useMemo(() => {
    if (!searchValue.trim()) {
      return dmnFiles;
    }
    return dmnFiles.filter((file: WorkspaceFile) =>
      file.nameWithoutExtension.toLowerCase().includes(searchValue.toLowerCase())
    );
  }, [dmnFiles, searchValue]);

  const handleFileToggle = useCallback((filePath: string, checked: boolean) => {
    setSelectedFiles((prev) => {
      const newSet = new Set(prev);
      if (checked) {
        newSet.add(filePath);
      } else {
        newSet.delete(filePath);
      }
      return newSet;
    });
  }, []);

  const handleGenerate = useCallback(() => {
    // TODO: Implement actual PDF generation logic
    console.log("Generate documentation for selected files:", Array.from(selectedFiles));

    // Close modal after generation
    props.onClose();
  }, [selectedFiles, props]);

  const handleCancel = useCallback(() => {
    // Reset selections and close modal
    setSelectedFiles(new Set());
    setSearchValue("");
    props.onClose();
  }, [props]);

  const selectedFilesList = useMemo(() => {
    return Array.from(selectedFiles).map((filePath) => {
      const file = dmnFiles.find((f: WorkspaceFile) => f.relativePath === filePath);
      return file?.nameWithoutExtension || filePath;
    });
  }, [selectedFiles, dmnFiles]);

  return (
    <Modal
      variant={ModalVariant.medium}
      title="Generate Documentation"
      isOpen={props.isOpen}
      onClose={handleCancel}
      actions={[
        <Button key="generate" variant="primary" onClick={handleGenerate} isDisabled={selectedFiles.size === 0}>
          Generate
        </Button>,
        <Button key="cancel" variant="link" onClick={handleCancel}>
          Cancel
        </Button>,
      ]}
    >
      <Stack hasGutter>
        <StackItem>
          <SearchInput
            placeholder="Search"
            value={searchValue}
            onChange={(_event, value) => setSearchValue(value)}
            onClear={() => setSearchValue("")}
            style={{ width: "100%" }}
          />
        </StackItem>

        <StackItem>
          <div
            style={{
              maxHeight: "300px",
              overflowY: "auto",
              border: "1px solid var(--pf-v5-global--BorderColor--100)",
              borderRadius: "3px",
              padding: "8px",
            }}
          >
            {filteredFiles.length === 0 ? (
              <Text component={TextVariants.p} style={{ textAlign: "center", padding: "16px" }}>
                {searchValue ? "No DMN files found matching your search." : "No DMN files found in workspace."}
              </Text>
            ) : (
              filteredFiles.map((file: WorkspaceFile) => (
                <div key={file.relativePath} style={{ padding: "4px 0" }}>
                  <Checkbox
                    id={`checkbox-${file.relativePath}`}
                    label={file.nameWithoutExtension}
                    isChecked={selectedFiles.has(file.relativePath)}
                    onChange={(_event, checked) => handleFileToggle(file.relativePath, checked)}
                  />
                </div>
              ))
            )}
          </div>
        </StackItem>

        {selectedFiles.size > 0 && (
          <StackItem>
            <TextContent>
              <Text component={TextVariants.h6}>Selected Items:</Text>
              <ul style={{ margin: "8px 0", paddingLeft: "20px" }}>
                {selectedFilesList.map((fileName) => (
                  <li key={fileName}>{fileName}</li>
                ))}
              </ul>
            </TextContent>
          </StackItem>
        )}
      </Stack>
    </Modal>
  );
};
