import Chip from "@mui/material/Chip";

export type ChipColor = "default" | "success" | "warning" | "error" | "info";

interface Props {
	label: string;
	color: ChipColor;
}

export default function StatusChip({ label, color }: Props) {
	return <Chip label={label} color={color} size="small" variant={color === "default" ? "outlined" : "filled"} />;
}
