// Third-party web component typing boundary for the 'altcha' package
declare namespace JSX {
  interface IntrinsicElements {
    'altcha-widget': React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        challengeurl?: string;
        challenge?: string;
        hidefooter?: boolean | string;
        hidelogo?: boolean | string;
        auto?: string;
        delay?: number | string;
        name?: string;
        ref?: React.Ref<any>;
      },
      HTMLElement
    >;
  }
}
