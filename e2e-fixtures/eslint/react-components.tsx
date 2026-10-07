import React, { useState, useEffect, createContext } from "react";

export const MyContext = createContext<{ count: number }>({ count: 0 });

export class ClassComponentWithDirectState extends React.Component<{}, { count: number }> {
  constructor(props: {}) {
    super(props);
    this.state = { count: 0 };
  }

  mutateDirectly() {
    this.state.count = 1;
  }

  render() {
    return <div>{this.state.count}</div>;
  }
}

export function BadReactComponent(props: { initialCount: number; items: string[]; data: { title: string } }) {
  // react-hooks/purity
  const randomValue = Math.random();

  // react-hooks/immutability
  props.data.title = "mutated";

  const [count, setCount] = useState(props.initialCount);
  const [derived, setDerived] = useState(0);
  const [card, setCard] = useState<string | null>(null);
  const [goldCardCount, setGoldCardCount] = useState(0);

  // react-hooks/set-state-in-render
  setCount(1);

  // react-hooks/rules-of-hooks
  if (props.initialCount > 0) {
    useEffect(() => {}, []);
  }

  // react-you-might-not-need-an-effect/no-adjust-state-on-prop-change
  useEffect(() => {
    setCard(null);
  }, [props.items]);

  // react-you-might-not-need-an-effect/no-derived-state
  useEffect(() => {
    setDerived(count * 2);
  }, [count]);

  // react-you-might-not-need-an-effect/no-chain-state-updates
  useEffect(() => {
    if (card !== null && card.startsWith("gold")) {
      setGoldCardCount((c) => c + 1);
    }
  }, [card]);

  // @eslint-react/web-api-no-leaked-timeout, interval, event-listener
  useEffect(() => {
    setTimeout(() => {}, 1000);
    setInterval(() => {}, 1000);
    window.addEventListener("resize", () => {});
  }, []);

  // react-hooks/exhaustive-deps
  useEffect(() => {
    console.log(count);
  }, []);

  // react/no-unstable-nested-components
  function NestedComponent() {
    return <span>nested</span>;
  }

  return (
    <MyContext.Provider value={{ count }}>
      <NestedComponent />
      {/* react/jsx-no-useless-fragment */}
      <><div /></>
      {/* react/jsx-key and react/no-array-index-key */}
      <div>
        {props.items.map((item) => (
          <span>{item}</span>
        ))}
      </div>
      <div>
        {props.items.map((item, index) => (
          <span key={index}>{item}</span>
        ))}
      </div>
      {/* react-perf/jsx-no-new-object-as-prop, new-array, new-function */}
      <div
        data-custom={{ a: 1, b: 2, c: 3, d: 4, e: 5 }}
        data-array={[1, 2, 3]}
        onClick={() => console.log(randomValue, derived, goldCardCount)}
      >
        {/* react/no-danger-with-children and @eslint-react/dom-no-dangerously-set-innerhtml-with-children */}
        <div dangerouslySetInnerHTML={{ __html: "<b>test</b>" }}>
          child content
        </div>
        {/* react/void-dom-elements-no-children and @eslint-react/dom-no-void-elements-with-children */}
        <img src="pic.jpg" alt="test">children</img>
      </div>
    </MyContext.Provider>
  );
}

// react-refresh/only-export-components
export function nonComponentHelperFunction() {
  return 42;
}
