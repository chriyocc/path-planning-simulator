type ControlBarProps = {
  slideIndex: number;
  slideCount: number;
  onBack: () => void;
  onNext: () => void;
  onSelect: (index: number) => void;
};

export const ControlBar = ({
  slideIndex,
  slideCount,
  onBack,
  onNext,
  onSelect
}: ControlBarProps) => {
  return (
    <div className="control-bar">
      <div className="button-row">
        <button type="button" onClick={onBack} disabled={slideIndex === 0}>
          Previous
        </button>
        <button type="button" onClick={onNext} disabled={slideIndex === slideCount - 1}>
          Next
        </button>
      </div>

      <div className="thumbnail-row">
        {Array.from({ length: slideCount }, (_, index) => (
          <button
            key={index}
            type="button"
            className={index === slideIndex ? "thumb is-active" : "thumb"}
            onClick={() => onSelect(index)}
            aria-label={`Go to slide ${index + 1}`}
          >
            {index + 1}
          </button>
        ))}
      </div>
    </div>
  );
};
