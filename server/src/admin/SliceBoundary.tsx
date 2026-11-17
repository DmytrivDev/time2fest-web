'use client';
/** Error boundary of one first-screen slice (AC-27): a failing slice shows an error in its place. */
import { Component, type ReactNode } from 'react';

interface Props {
  label: string;
  children: ReactNode;
}

export class SliceBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <p role="alert" data-testid="slice-error">
          {`Зріз «${this.props.label}» не відмалювався`}
        </p>
      );
    }
    return this.props.children;
  }
}
