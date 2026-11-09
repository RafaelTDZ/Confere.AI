import { describe, expect, it } from "vitest";
import { parseCmaMarkdown } from "@/lib/tracking/providers/cma";

/** Trecho real da página de rastreio da CMA (container CMAU6443016). */
const MARKDOWN = `## Tracking details

Vessel Departure

- Container **CMAU6443016**
- **45G1** **(40HC)**
- [New search](https://www.cma-cgm.com/ebusiness/tracking/.search-wrapper)

[Export PDF](https://www.cma-cgm.com/ebusiness/tracking/export-pdf?containerID=CMAU6443016&fileType=pdf)

- POL**SHEKOU (CN)**

- POD**ITAPOA, SC (BR)**

ETA Berth at POD

Mon 09-NOV-202612:30 PM

2 days Remaining

|  |  | Date | Moves | Location<br>Terminal | Vessel (Voyage) |
| --- | --- | --- | --- | --- | --- |

|     |     |     |     |     |     |
| --- | --- | --- | --- | --- | --- |
| [Display Previous Moves](https://www.cma-cgm.com/x) |  |  |  |  |  |
| [Display Previous Moves](https://www.cma-cgm.com/x) |  | Tuesday, 06-OCT-202608:54 PM | Vessel Departure | SHEKOU<br>SHEKOU CONTAINER TERMINAL LTD | [CMA CGM COBALT](https://www.cma-cgm.com/the-group/activities/shipping/vessel/9996680/cma-cgm-cobalt) [( 0BDPHW1MA)](https://www.cma-cgm.com/ebusiness/schedules/voyage/detail?VoyageReference=0BDPHW1MA) |
| [Display Previous Moves](https://www.cma-cgm.com/x) |  | Monday, 09-NOV-202612:30 PM | Planned Vessel Arrival | ITAPOA, SC<br>ITAPOA TERMINAIS PORTUARIOS | [CMA CGM COBALT](https://www.cma-cgm.com/the-group/activities/shipping/vessel/9996680/cma-cgm-cobalt) [( 0BDPIE1MA)](https://www.cma-cgm.com/ebusiness/schedules/voyage/detail?VoyageReference=0BDPIE1MA) |

Times reflected are local Times`;

describe("parseCmaMarkdown", () => {
  it("extrai container, eventos, navio/viagem e ETA", () => {
    const parsed = parseCmaMarkdown(MARKDOWN, "CMAU6443016");

    expect(parsed).not.toBeNull();
    expect(parsed?.found).toBe(true);
    expect(parsed?.containers[0]?.number).toBe("CMAU6443016");
    expect(parsed?.containers[0]?.events).toEqual([
      {
        date: "06-OCT-2026 08:54 PM",
        location: "SHEKOU · SHEKOU CONTAINER TERMINAL LTD",
        description: "Vessel Departure",
      },
      {
        date: "09-NOV-2026 12:30 PM",
        location: "ITAPOA, SC · ITAPOA TERMINAIS PORTUARIOS",
        description: "Planned Vessel Arrival",
      },
    ]);
    // Viagem do evento realizado, não da previsão de chegada.
    expect(parsed?.vessel).toBe("CMA CGM COBALT");
    expect(parsed?.voyage).toBe("0BDPHW1MA");
    expect(parsed?.eta).toBe("09-NOV-2026 12:30 PM");
    expect(parsed?.pol).toBe("SHEKOU (CN)");
    expect(parsed?.pod).toBe("ITAPOA, SC (BR)");
  });

  it("usa o número consultado quando a página não repete o container", () => {
    const semContainer = MARKDOWN.replace(
      /- Container \*\*CMAU6443016\*\*\n/,
      "",
    );
    expect(
      parseCmaMarkdown(semContainer, "CMAU6443016")?.containers[0]?.number,
    ).toBe("CMAU6443016");
  });

  it("devolve null quando a página não traz resultado de rastreio", () => {
    expect(
      parseCmaMarkdown("<html>No results</html>", "CMAU6443016"),
    ).toBeNull();
  });
});
