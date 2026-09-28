import { render, screen } from "@testing-library/react-native";
import { Tag } from "./tag";
it("D06 labels the demo with the attention tone", async () => {
  await render(<Tag>Demo</Tag>);
  expect(screen.getByText("Demo")).toHaveProp(
    "className",
    "text-status-attention-fg",
  );
});
