import { Link } from "./Link.ts";

export class NavigationFeedLink extends Link {
  protected override type: string =
    "application/atom+xml;profile=opds-catalog;kind=navigation";
}
