import React from "react";

export function InaccessibleComponent() {
  return (
    <div>
      <img src="photo.jpg" />
      <div role="invalid-aria-role">content</div>
    </div>
  );
}
