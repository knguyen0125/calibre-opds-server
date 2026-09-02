import { Link } from "./Link.ts";

export class AcquisitionFeedLink extends Link {
  protected override type: string =
    "application/atom+xml;profile=opds-catalog;kind=acquisition";
}
