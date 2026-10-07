"use client";

import React, { useId } from "react";

/**
 * Accessible button component rendering labeled interactive control.
 *
 * @param props Component properties.
 * @param props.label Button text label.
 * @param props.onClick Click handler.
 * @returns JSX button element.
 */
export function CleanButton(props: { readonly label: string; readonly onClick: () => void }): React.JSX.Element {
  const elementId = useId();

  return (
    <button id={elementId} type="button" onClick={props.onClick}>
      {props.label}
    </button>
  );
}
