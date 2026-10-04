import {
  InMemorySearchCursorCodec,
  InMemorySearchProvider,
  SearchApplicationService,
  type SearchAuthorizationService,
  type SearchPrincipal,
  type SearchResultHydrator,
} from "../../worker/search";

const WORKHUB_SEARCH_DOCUMENTS = [
  {
    resourceType: "travel_request",
    resourceId: "travel-aoi-tokyo",
    category: "requests",
    title: "Tokyo travel request",
    text: "Aoi Tokyo business trip",
  },
  {
    resourceType: "travel_request",
    resourceId: "travel-other-tokyo",
    category: "requests",
    title: "Tokyo travel request",
    text: "Other employee Tokyo business trip",
  },
  {
    resourceType: "app",
    resourceId: "travel-request-app",
    category: "apps",
    title: "Travel Request",
    text: "Create and review business trip requests",
  },
] as const;

const canSee = (principalId: string, resourceType: string, resourceId: string): boolean => {
  if (resourceType === "app") return true;
  if (principalId === "aoi") return resourceId === "travel-aoi-tokyo";
  if (principalId === "ren") return resourceType === "travel_request";
  return false;
};

const authorization: SearchAuthorizationService = {
  async authorizeBatch(input) {
    return input.candidates.map((candidate) => ({
      resourceType: candidate.resourceType,
      resourceId: candidate.resourceId,
      allowed: canSee(input.principal.principalId, candidate.resourceType, candidate.resourceId),
    }));
  },
};

const hydrator: SearchResultHydrator = {
  async hydrateBatch(input) {
    return input.candidates.flatMap((candidate) => {
      const source = WORKHUB_SEARCH_DOCUMENTS.find(
        (document) => document.resourceType === candidate.resourceType && document.resourceId === candidate.resourceId,
      );
      if (!source) return [];
      return [{
        resourceType: source.resourceType,
        resourceId: source.resourceId,
        category: source.category,
        title: source.title,
        actionTarget: `${source.resourceType}:${source.resourceId}`,
      }];
    });
  },
};

export const createWorkhubReferenceSearch = (): SearchApplicationService =>
  new SearchApplicationService(
    new InMemorySearchProvider(WORKHUB_SEARCH_DOCUMENTS),
    authorization,
    hydrator,
    new InMemorySearchCursorCodec(),
  );

export const workhubSearchPrincipal = (principalId: "aoi" | "ren"): SearchPrincipal => ({
  principalId,
  environment: "test",
});
